/**
 * The places sources name a key no catalog has: `m.key`, `m?.key`, `m["key"]`, a per-key path, or a
 * named import of keys.js. TypeScript sees them only in TypeScript, so in JavaScript and in a
 * Svelte or Vue template such a call would ship as a call of nothing.
 */

import { type Uncertain, uncertainAt } from "./code-text.ts";
import type { Config } from "./config.ts";
import { GraiError } from "./error.ts";
import { keysFileOf } from "./keys-file.ts";
import {
	type MessageBindings,
	messageBindings,
	projectNamespaces,
	statementAt,
} from "./message-imports.ts";
import { redeclarations } from "./redeclarations.ts";
import {
	before,
	occurrencesOf,
	positionOf,
	type SourceFile,
	unescaped,
} from "./sources.ts";

/** A key a source names: the key, where its name starts, and how the source writes it. */
type NamedKey = { key: string; at: number; written: string };

/**
 * A file whose reads of a namespace check left out, and where: as it declares the name again, or
 * as the scan cannot read that place with certainty (`code-text.ts`), it being maybe JSX text or
 * after a `/` that may start a regular expression.
 */
export type Unchecked = {
	file: string;
	name: string;
	line: number;
	column: number;
	why: "declared" | Uncertain["why"];
};

/** After a namespace's name: `.key` or `?.key`, or `["key"]`, `?.["key"]` and the same in single quotes. */
const access =
	/\s*(?:\?\.|\.)\s*(?<member>(?:[\w$]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})+)|\s*(?:\?\.)?\s*\[\s*(?<quote>["'])(?<literal>[^"'\\\r\n]*)\k<quote>\s*\]/dy;

/**
 * An error for each place the files name a key that no catalog has, with the `grai add` command
 * that adds it in every locale. A named import counts only from the project's own keys.js, so a
 * module of the app's that is named keys too is not taken for it. The text alone cannot tell which
 * of two declarations of a name a read is of, so where a file declares a namespace's name again,
 * as a parameter or a variable, its reads of that name are left out, and listed as unchecked: a
 * correct file never fails the check. So are the reads where the scan is uncertain. The Vite
 * plugin reads each module by scope and with a parser instead.
 */
export function missingKeyCalls(
	files: readonly SourceFile[],
	keys: ReadonlySet<string>,
	config: Config,
): { errors: GraiError[]; unchecked: Unchecked[] } {
	const namespaces = projectNamespaces(files);
	const texts = config.locales.map((locale) => `--${locale} "…"`).join(" ");
	const isKeys = keysFileOf(config);
	const unchecked: Unchecked[] = [];
	const errors = files.flatMap((source) => {
		const bindings = messageBindings(source.code, namespaces, (specifier) =>
			isKeys(specifier, source.path),
		);
		const shadowed = new Set<string>();
		for (const name of bindings.namespaces) {
			const [again] = redeclarations(source.code, name, bindings);
			if (again === undefined) continue;
			shadowed.add(name);
			unchecked.push({
				file: source.file,
				name,
				...positionOf(source.text, again),
				why: "declared",
			});
		}
		for (const name of bindings.namespaces) {
			const read = uncertainRead(source, name);
			if (read === undefined) continue;
			const { at, why } = read;
			unchecked.push({
				file: source.file,
				name,
				...positionOf(source.text, at),
				why,
			});
		}
		return namedKeys(source.code, bindings, shadowed)
			.filter(({ at }) => uncertainAt(source.uncertain, at) === undefined)
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

/** The first place a file may read a namespace where the scan is uncertain, and why. */
function uncertainRead(
	source: SourceFile,
	name: string,
): { at: number; why: Uncertain["why"] } | undefined {
	if (source.uncertain.length === 0) return undefined;
	for (const at of occurrencesOf(source.text, name)) {
		const place = uncertainAt(source.uncertain, at);
		access.lastIndex = at + name.length;
		if (place !== undefined && access.test(source.text)) {
			return { at, why: place.why };
		}
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
	const key = unescaped(text.slice(span[0], span[1]));
	const written = text.slice(at, match.index + match[0].length).trim();
	return { key, at: span[0], written };
}
