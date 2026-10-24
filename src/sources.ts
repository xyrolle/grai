import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

/** Files that can name a message: JavaScript, TypeScript and the components of Svelte and Vue. */
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
]);
/** Directories of dependencies and of build output, which name no message of the project's own. */
const skippedDirectories = new Set(["node_modules", "dist", "build"]);
/** An identifier: a name that starts with a letter, `_` or `$`, and is not the end of a longer one. */
const identifier = /(?<![\w$])[A-Za-z_$][\w$]*/g;

/** A source file: its path, the path the project shows (relative to its root), and its text. */
export type SourceFile = { path: string; file: string; text: string };

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
				files.push({ path, file: relative(projectRoot, path), text });
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

/** Every identifier the files write: a key counts as named when it is one of them. */
export function namesIn(files: readonly SourceFile[]): Set<string> {
	const names = new Set<string>();
	for (const { text } of files) {
		for (const name of text.match(identifier) ?? []) names.add(name);
	}
	return names;
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
