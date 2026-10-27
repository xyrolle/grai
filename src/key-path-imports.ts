/**
 * The named imports of keys.js in a project whose package.json `imports` give each key its own path
 * (`"#i18n/messages/*": "./src/lib/i18n/keys.js"`). An editor writes them: TypeScript sees one
 * module for every key's path, so its auto-import offers keys.js, TypeScript 7's as TypeScript 6's.
 * A key imported from keys.js is not imported by its path, so a test's mock of that path never
 * reaches it. check reports each such import, and check --fix writes it as an import of each key
 * from its own path.
 */

import { fileSpan, type ImportFact, type Span } from "./code/facts.ts";
import type { ESTree } from "./code/parse.ts";
import type { ProjectCode, SourceCode } from "./code/project.ts";
import { readCode } from "./code/read.ts";
import type { KeysImport, Reading } from "./code/reads.ts";
import { GraiError } from "./error.ts";
import { applyEdits, type Edit } from "./migrate/edits.ts";
import { positionOf } from "./sources.ts";
import { writeAll } from "./write-all.ts";

/** An import of keys from keys.js, with each key's own path from the importing file. */
export type KeysImportPaths = KeysImport & {
	paths: ReadonlyMap<string, string>;
};

/**
 * Each import of keys by name from keys.js that the reading found, `import { title } from
 * "./out/keys.js"`, when the project gives each key its own path. An import of the namespace,
 * `import * as m`, reads keys.js whole, and a re-export passes keys on, so neither is one.
 */
export async function keysImports(
	code: ProjectCode,
	reading: Reading,
): Promise<KeysImportPaths[]> {
	if (code.keyPaths.length === 0) return [];
	const found: KeysImportPaths[] = [];
	for (const each of reading.keysImports) {
		const paths = await ownPaths(code, each.path, each.fact);
		if (paths !== undefined) found.push({ ...each, paths });
	}
	return found;
}

/**
 * The own path of each key an import of keys.js names, if it names keys alone and each has a path
 * the project resolves to that key's module from the importing file.
 */
async function ownPaths(
	{ graph, keyPaths }: ProjectCode,
	importer: string,
	{ names }: ImportFact,
): Promise<Map<string, string> | undefined> {
	if (names.some(({ imported }) => imported === "*" || imported === "default"))
		return undefined;
	const paths = new Map<string, string>();
	for (const { imported: key } of names) {
		const own = await keyPathOf(graph, keyPaths, key, importer);
		if (own === undefined) return undefined;
		paths.set(key, own);
	}
	return paths;
}

/** A key's own path by the first pattern that resolves it to that key's module, as the build does. */
async function keyPathOf(
	graph: ProjectCode["graph"],
	patterns: readonly string[],
	key: string,
	importer: string,
): Promise<string | undefined> {
	for (const pattern of patterns) {
		// `#i18n/messages/*` takes `title.js` for its `*`, and `#i18n/messages/*.js` takes `title`.
		const [prefix = "", suffix = ""] = pattern.split("*");
		const path = `${prefix}${key}${suffix === "" ? ".js" : suffix}`;
		const resolved = await graph.resolve(path, importer);
		if (resolved !== undefined && graph.output.keyOf(resolved) === key) {
			return path;
		}
	}
	return undefined;
}

/** The error check reports for each import of keys from keys.js. */
export function keysImportProblems(
	imports: readonly KeysImportPaths[],
): GraiError[] {
	return imports.map(({ source, at, paths }) => {
		const [first = ""] = paths.values();
		return new GraiError(
			"key-path-bypassed",
			{ file: placeOf(source, at) },
			`imports ${[...paths.keys()].join(", ")} from keys.js, though package.json gives each key its own path: a mock of "${first}" reaches only the files that import the key by that path. Import each from its own path, as grai check --fix does.`,
		);
	});
}

/** An import check --fix wrote as one per key: where it was, as `file:line:column`, and its keys. */
export type MovedImport = { place: string; keys: string[] };

/**
 * Writes each import of keys from keys.js as an import of each key from its own path, keeping
 * whether it imports a type, the name it binds, the quotes and the semicolon, in every file or in
 * none. An import with a comment in it stays as it is, as its comment would have no place, and
 * check reports it still.
 */
export async function importKeysByPath(
	imports: readonly KeysImportPaths[],
): Promise<MovedImport[]> {
	const files = new Map(imports.map(({ path, source }) => [path, source]));
	const texts = new Map<string, string>();
	const moved: MovedImport[] = [];
	for (const [path, { text }] of files) {
		const modules = await readCode(path, text);
		if (!Array.isArray(modules)) continue;
		const found = imports.filter((each) => each.path === path);
		const edits: Edit[] = [];
		for (const { program, source } of modules) {
			for (const declaration of program.body) {
				if (declaration.type !== "ImportDeclaration") continue;
				const at = fileSpan(source, declaration.source);
				const keys = found.find((each) => each.at.start === at.start);
				if (keys === undefined) continue;
				const written = byPath(source.text, declaration, keys.paths);
				if (written === undefined) continue;
				edits.push({ ...fileSpan(source, declaration), text: written });
				moved.push({
					place: placeOf(keys.source, keys.at),
					keys: [...keys.paths.keys()],
				});
			}
		}
		if (edits.length > 0) texts.set(path, applyEdits(text, edits));
	}
	writeAll(texts);
	return moved;
}

/**
 * An import of keys.js written as an import of each key from its own path, or undefined when it
 * holds a comment.
 */
function byPath(
	text: string,
	declaration: ESTree.ImportDeclaration,
	paths: ReadonlyMap<string, string>,
): string | undefined {
	const clause = text.slice(declaration.start, declaration.source.start);
	if (/\/[/*]/.test(clause)) return undefined;
	const quote = text[declaration.source.start];
	const rest = text.slice(declaration.source.end, declaration.end);
	const lineStart = text.lastIndexOf("\n", declaration.start - 1) + 1;
	const before = text.slice(lineStart, declaration.start);
	const between = `\n${before.trim() === "" ? before : ""}`;
	const written: string[] = [];
	for (const specifier of declaration.specifiers) {
		if (specifier.type !== "ImportSpecifier") return undefined;
		// A key is a name, so it is written as one, also where the import wrote it as a string.
		const key =
			specifier.imported.type === "Identifier"
				? specifier.imported.name
				: specifier.imported.value;
		const path = paths.get(key);
		if (path === undefined) return undefined;
		const local = specifier.local.name;
		const named = local === key ? key : `${key} as ${local}`;
		const type =
			declaration.importKind === "type" || specifier.importKind === "type"
				? "type "
				: "";
		written.push(
			`import ${type}{ ${named} } from ${quote}${path}${quote}${rest}`,
		);
	}
	return written.join(between);
}

/** Where an import's path is, as `file:line:column`. */
function placeOf(source: SourceCode, at: Span): string {
	const { line, column } = positionOf(source.text, at.start);
	return `${source.file}:${line}:${column}`;
}

/** What check --fix prints for each import it moved onto the keys' own paths. */
export function movedLines(moved: readonly MovedImport[]): string[] {
	return moved.map(
		({ place, keys }) =>
			`moved: ${place}: ${keys.join(", ")}, each to its own path`,
	);
}
