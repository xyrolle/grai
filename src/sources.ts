import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { codeText } from "./code-text.ts";
import { globMatcher } from "./globs.ts";

/**
 * Files that can name a message: JavaScript, TypeScript, the components of Svelte, Vue and Astro,
 * and MDX documents. A file of a kind left out here would name keys that check --fix then deletes.
 */
const sourceExtensions = new Set([
	".js",
	".mjs",
	".cjs",
	".jsx",
	".ts",
	".mts",
	".cts",
	".tsx",
	".svelte",
	".vue",
	".astro",
	".mdx",
]);
/** Directories of dependencies and of build output, which name no message of the project's own. */
const skippedDirectories = new Set(["node_modules", "dist", "build"]);
/**
 * An identifier: a name that starts with a letter, `_` or `$`, and is not the end of a longer one,
 * any of its characters maybe written as an escape, `\u0069`.
 */
const identifier =
	/(?<![\w$\\])(?:[A-Za-z_$]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})(?:[\w$]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})*/g;
/** An identifier without escapes, as most files write every one: matched far faster. */
const plainIdentifier = /(?<![\w$])[A-Za-z_$][\w$]*/g;
const unicodeEscape = /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g;

/**
 * A source file: its path, the path the project shows (relative to its root), its text, and its
 * code: the text with comments and literals blanked at the same offsets (`code-text.ts`), which a
 * scan for what the code reads goes through. The code is worked out the first time a scan reads
 * it, as most commands read only the files that write a name they look for.
 */
export type SourceFile = {
	readonly path: string;
	readonly file: string;
	readonly text: string;
	readonly code: string;
};

/** A source file of a text, its code blanked when first read. */
export function sourceFile(
	path: string,
	file: string,
	text: string,
): SourceFile {
	let code: string | undefined;
	return {
		path,
		file,
		text,
		get code() {
			code ??= codeText(text, path);
			return code;
		},
	};
}

/**
 * The source files under the roots, each read whole, outside the outdir, dependencies, build
 * output and dot-directories.
 */
export function sourceFiles(
	roots: readonly string[],
	projectRoot: string,
	outdir: string,
): SourceFile[] {
	const files: SourceFile[] = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				const skipped =
					entry.name.startsWith(".") ||
					skippedDirectories.has(entry.name) ||
					path === outdir;
				if (!skipped) visit(path);
			} else if (sourceExtensions.has(extname(entry.name))) {
				const text = readFileSync(path, "utf8");
				files.push(sourceFile(path, relative(projectRoot, path), text));
			}
		}
	};
	for (const root of roots) visit(root);
	return files;
}

/** Each offset at which a text writes a name as a whole identifier, in strings and comments too. */
export function occurrencesOf(text: string, name: string): number[] {
	const pattern = new RegExp(
		`(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`,
		"g",
	);
	return [...text.matchAll(pattern)].map((match) => match.index);
}

/**
 * Every identifier the files write, in their strings and comments too, and an escaped one as the
 * name it spells: a key counts as named when it is one of them, so check --fix keeps it.
 */
export function namesIn(files: readonly SourceFile[]): Set<string> {
	const names = new Set<string>();
	for (const { text } of files) {
		if (!text.includes("\\u")) {
			for (const written of text.match(plainIdentifier) ?? [])
				names.add(written);
			continue;
		}
		for (const written of text.match(identifier) ?? []) {
			names.add(unescaped(written));
		}
	}
	return names;
}

/** Each identifier code writes with an escape, as the name it spells, and where it is. */
export function escapedNames(code: string): { name: string; at: number }[] {
	return [...code.matchAll(identifier)]
		.filter(([written]) => written.includes("\\"))
		.map((match) => ({ name: unescaped(match[0]), at: match.index }));
}

/** An identifier as the name it spells, its escapes read. */
export function unescaped(written: string): string {
	return written.replace(unicodeEscape, (_, braced, four) =>
		String.fromCodePoint(Number.parseInt(braced ?? four, 16)),
	);
}

/** A test file, by the path the project shows, and the identifiers it writes. */
export type TestNames = { file: string; names: ReadonlySet<string> };

/**
 * The source files that ship, and the names each test writes. A file is a test when one of the
 * config's `tests` globs matches its path from the project's root.
 */
export function splitTests(
	files: readonly SourceFile[],
	tests: readonly string[],
): { shipped: SourceFile[]; tests: TestNames[] } {
	const isTest = globMatcher(tests);
	const shipped: SourceFile[] = [];
	const testNames: TestNames[] = [];
	for (const source of files) {
		if (isTest(source.file.replaceAll(sep, "/"))) {
			testNames.push({ file: source.file, names: namesIn([source]) });
		} else {
			shipped.push(source);
		}
	}
	return { shipped, tests: testNames };
}

/** The tests that write a name, sorted by path, for a message: the first three, then how many more. */
export function testsNaming(
	tests: readonly TestNames[],
	name: string,
): string | undefined {
	const files = tests
		.filter(({ names }) => names.has(name))
		.map(({ file }) => file)
		.toSorted();
	if (files.length === 0) return undefined;
	const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
	return files.slice(0, 3).join(", ") + more;
}

/** The line and column, both from 1, of an offset in a text. */
export function positionOf(
	text: string,
	at: number,
): { line: number; column: number } {
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	let line = 1;
	let index = text.indexOf("\n");
	while (index !== -1 && index < at) {
		line++;
		index = text.indexOf("\n", index + 1);
	}
	return { line, column: at - lineStart + 1 };
}

/** The line an offset is on, without its line break. */
export function lineAt(text: string, at: number): string {
	const start = text.lastIndexOf("\n", at - 1) + 1;
	const end = text.indexOf("\n", at);
	return text.slice(start, end === -1 ? text.length : end).replace(/\r$/, "");
}

/** The offset of the last character before `at` that is not whitespace, or -1. */
export function before(text: string, at: number): number {
	let index = at - 1;
	while (index >= 0 && /\s/.test(text[index] ?? "")) index--;
	return index;
}

/** The offset of the first character from `at` that is not whitespace. */
export function after(text: string, at: number): number {
	let index = at;
	while (index < text.length && /\s/.test(text[index] ?? "")) index++;
	return index;
}

/** The identifier that ends at `end`, inclusive, or "" when none does. */
export function nameEndingAt(text: string, end: number): string {
	let start = end;
	while (start >= 0 && /[\w$]/.test(text[start] ?? "")) start--;
	return text.slice(start + 1, end + 1);
}
