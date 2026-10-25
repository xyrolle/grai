/**
 * The places sources name a key no catalog has: `m.key`, `m?.key`, `m["key"]`, a per-key path, or a
 * named import of keys.js. TypeScript sees them only in TypeScript, so in JavaScript and in a
 * Svelte or Vue template such a call would ship as a call of nothing.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "./config.ts";
import { GraiError } from "./error.ts";
import {
	type MessageBindings,
	messageBindings,
	namespaceNames,
	statementAt,
} from "./message-imports.ts";
import { redeclarations } from "./redeclarations.ts";
import {
	before,
	occurrencesOf,
	positionOf,
	type SourceFile,
} from "./sources.ts";

/** A key a source names: the key, where its name starts, and how the source writes it. */
type NamedKey = { key: string; at: number; written: string };

/** A file whose reads of a namespace check left out, as it declares the name again there. */
export type Unchecked = {
	file: string;
	name: string;
	line: number;
	column: number;
};

/** After a namespace's name: `.key` or `?.key`, or `["key"]`, `?.["key"]` and the same in single quotes. */
const access =
	/\s*(?:\?\.|\.)\s*(?<member>[A-Za-z_$][\w$]*)|\s*(?:\?\.)?\s*\[\s*(?<quote>["'])(?<literal>[^"'\\\r\n]*)\k<quote>\s*\]/dy;

/**
 * An error for each place the files name a key that no catalog has, with the `grai add` command
 * that adds it in every locale. A named import counts only from the project's own keys.js, so a
 * module of the app's that is named keys too is not taken for it. The text alone cannot tell which
 * of two declarations of a name a read is of, so where a file declares a namespace's name again,
 * as a parameter or a variable, its reads of that name are left out, and listed as unchecked: a
 * correct file never fails the check. The Vite plugin reads each module by scope instead.
 */
export function missingKeyCalls(
	files: readonly SourceFile[],
	keys: ReadonlySet<string>,
	config: Config,
): { errors: GraiError[]; unchecked: Unchecked[] } {
	const namespaces = namespaceNames(files.map(({ text }) => text));
	const texts = config.locales.map((locale) => `--${locale} "…"`).join(" ");
	const isKeys = keysFileOf(config);
	const unchecked: Unchecked[] = [];
	const errors = files.flatMap((source) => {
		const bindings = messageBindings(source.text, namespaces, (specifier) =>
			isKeys(specifier, source.path),
		);
		const shadowed = new Set<string>();
		for (const name of bindings.namespaces) {
			const [again] = redeclarations(source.text, name, bindings);
			if (again === undefined) continue;
			shadowed.add(name);
			unchecked.push({
				file: source.file,
				name,
				...positionOf(source.text, again),
			});
		}
		return namedKeys(source.text, bindings, shadowed)
			.filter(({ key }) => !keys.has(key))
			.map(({ key, at, written }) => {
				const { line, column } = positionOf(source.text, at);
				return new GraiError(
					"key-missing",
					{ file: `${source.file}:${line}:${column}`, key },
					`${written} names a key no catalog has. Add it with grai add ${key} ${texts}, or fix the name.`,
				);
			});
	});
	return { errors, unchecked };
}

/**
 * Whether an import path names the project's keys.js: a relative path to it, a path the project's
 * package.json `imports` map to it, or an alias the bundler resolves, such as SvelteKit's `$lib`,
 * that ends in the output's own directory and `keys`.
 */
function keysFileOf(
	config: Config,
): (specifier: string, importer: string) => boolean {
	const keysFile = join(resolve(config.root, config.outdir), "keys");
	const imports = packageImports(config.root);
	const tail = `${basename(config.outdir)}/keys`;
	return (specifier, importer) => {
		const target = specifier.startsWith(".")
			? resolve(dirname(importer), specifier)
			: specifier.startsWith("#")
				? importTarget(imports, specifier, config.root)
				: undefined;
		const named = target ?? specifier;
		const written = named.replace(/\.[cm]?[jt]s$/, "");
		return target === undefined ? written.endsWith(tail) : written === keysFile;
	};
}

/** The `imports` of the project's package.json, each a path by its specifier or pattern. */
function packageImports(root: string): ReadonlyMap<string, string> {
	try {
		const { imports } = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		);
		if (typeof imports !== "object" || imports === null) return new Map();
		return new Map(
			Object.entries(imports).flatMap(([pattern, target]) =>
				typeof target === "string" ? [[pattern, target]] : [],
			),
		);
	} catch {
		return new Map();
	}
}

/** The file a `#` import names through package.json, as Node maps it, or nothing. */
function importTarget(
	imports: ReadonlyMap<string, string>,
	specifier: string,
	root: string,
): string | undefined {
	const exact = imports.get(specifier);
	if (exact !== undefined) return resolve(root, exact);
	for (const [pattern, target] of imports) {
		const [prefix = "", suffix] = pattern.split("*");
		if (suffix === undefined) continue;
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
		const matched = specifier.slice(
			prefix.length,
			specifier.length - suffix.length,
		);
		return resolve(root, target.replace("*", matched));
	}
	return undefined;
}

/** Every key a file names, by its imports and by reading its namespaces but the shadowed ones. */
function namedKeys(
	text: string,
	bindings: MessageBindings,
	shadowed: ReadonlySet<string>,
): NamedKey[] {
	const imported = bindings.statements.flatMap(
		({ module, names, specifier }): NamedKey[] => {
			if (module.type === "key") {
				const at = specifier.at + specifier.text.lastIndexOf(module.key);
				return [{ key: module.key, at, written: specifier.text }];
			}
			if (module.type !== "keys") return [];
			return names.map(({ imported: key, at }) => ({ key, at, written: key }));
		},
	);
	const read = [...bindings.namespaces]
		.filter((name) => !shadowed.has(name))
		.flatMap((name) =>
			occurrencesOf(text, name).flatMap(
				(at) => memberAt(text, at, name, bindings) ?? [],
			),
		);
	return [...imported, ...read];
}

/** The key a namespace's name at `at` reads by name, unless the name is an import's or a property. */
function memberAt(
	text: string,
	at: number,
	name: string,
	bindings: MessageBindings,
): NamedKey | undefined {
	const declared = statementAt(bindings, at) !== undefined;
	if (declared || text[before(text, at)] === ".") return undefined;
	access.lastIndex = at + name.length;
	const match = access.exec(text);
	const groups = match?.indices?.groups;
	const span = groups?.member ?? groups?.literal;
	if (match === null || span === undefined) return undefined;
	const key = text.slice(span[0], span[1]);
	const written = text.slice(at, match.index + match[0].length).trim();
	return { key, at: span[0], written };
}
