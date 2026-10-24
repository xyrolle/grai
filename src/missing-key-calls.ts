/**
 * The places sources name a key no catalog has: `m.key`, `m?.key`, `m["key"]`, a per-key path, or a
 * named import of keys.js. TypeScript sees them only in TypeScript, so in JavaScript and in a
 * Svelte or Vue template such a call would ship as a call of nothing.
 */

import { GraiError } from "./error.ts";
import {
	type MessageBindings,
	messageBindings,
	namespaceNames,
	statementAt,
} from "./message-imports.ts";
import {
	before,
	occurrencesOf,
	positionOf,
	type SourceFile,
} from "./sources.ts";

/** A key a source names: the key, where its name starts, and how the source writes it. */
type NamedKey = { key: string; at: number; written: string };

/** After a namespace's name: `.key` or `?.key`, or `["key"]`, `?.["key"]` and the same in single quotes. */
const access =
	/\s*(?:\?\.|\.)\s*(?<member>[A-Za-z_$][\w$]*)|\s*(?:\?\.)?\s*\[\s*(?<quote>["'])(?<literal>[^"'\\\r\n]*)\k<quote>\s*\]/dy;

/**
 * An error for each place the files name a key that no catalog has, with the `grai add` command
 * that adds it in every locale.
 */
export function missingKeyCalls(
	files: readonly SourceFile[],
	keys: ReadonlySet<string>,
	locales: readonly string[],
): GraiError[] {
	const namespaces = namespaceNames(files.map(({ text }) => text));
	const texts = locales.map((locale) => `--${locale} "…"`).join(" ");
	return files.flatMap((source) =>
		namedKeys(source.text, messageBindings(source.text, namespaces))
			.filter(({ key }) => !keys.has(key))
			.map(({ key, at, written }) => {
				const { line, column } = positionOf(source.text, at);
				return new GraiError(
					"key-missing",
					{ file: `${source.file}:${line}:${column}`, key },
					`${written} names a key no catalog has. Add it with grai add ${key} ${texts}, or fix the name.`,
				);
			}),
	);
}

/** Every key a file names, by its imports and by reading its namespaces. */
function namedKeys(text: string, bindings: MessageBindings): NamedKey[] {
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
	const read = [...bindings.namespaces].flatMap((name) =>
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
