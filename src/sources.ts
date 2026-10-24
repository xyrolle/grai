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

/** Every identifier the files write: a key counts as named when it is one of them. */
export function namesIn(files: readonly SourceFile[]): Set<string> {
	const names = new Set<string>();
	for (const { text } of files) {
		for (const name of text.match(identifier) ?? []) names.add(name);
	}
	return names;
}
