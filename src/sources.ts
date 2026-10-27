import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

/**
 * Files that can name a message: JavaScript, TypeScript, the components of Svelte, Vue and Astro,
 * and MDX documents. A file of a kind left out here would name keys that check --fix then deletes.
 */
export const sourceExtensions: ReadonlySet<string> = new Set([
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
/** A source file: its path, the path the project shows (relative to its root), and its text. */
export type SourceFile = {
	readonly path: string;
	readonly file: string;
	readonly text: string;
};

/**
 * What a listing of the sources saw beside them: the symlinks, the package.json files, and the
 * directories it left out, the output's aside.
 */
export type Seen = { links: string[]; manifests: string[]; skipped: string[] };

/**
 * The source files under the roots, each read whole, outside the outdir, dependencies, build
 * output and dot-directories; with `seen`, also what it saw beside them.
 */
export function sourceFiles(
	roots: readonly string[],
	projectRoot: string,
	outdir: string,
	seen?: Seen,
): SourceFile[] {
	return sourcePaths(roots, outdir, seen).map((path) => ({
		path,
		file: relative(projectRoot, path),
		text: readFileSync(path, "utf8"),
	}));
}

/** The paths of the source files under the roots that `sourceFiles` reads, in its order. */
export function sourcePaths(
	roots: readonly string[],
	outdir: string,
	seen?: Seen,
): string[] {
	const paths: string[] = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) seen?.links.push(path);
			if (entry.name === "package.json") seen?.manifests.push(path);
			if (entry.isDirectory()) {
				const skipped =
					entry.name.startsWith(".") ||
					skippedDirectories.has(entry.name) ||
					path === outdir;
				if (!skipped) visit(path);
				else if (path !== outdir) seen?.skipped.push(path);
			} else if (sourceExtensions.has(extname(entry.name))) {
				paths.push(path);
			}
		}
	};
	for (const root of roots) visit(root);
	return paths;
}

/** A test file, by the path the project shows, and the keys it reads. */
export type TestNames = { file: string; names: ReadonlySet<string> };

/** The tests that read a key, sorted by path, for a message: the first three, then how many more. */
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
