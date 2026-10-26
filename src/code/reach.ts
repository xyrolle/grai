/**
 * The keys a load by a pattern of paths may reach: a dynamic import by a template, which Vite
 * expands into a glob, or `import.meta.glob`. A pattern whose paths resolve, `*` standing for a
 * key's name, to a key's own module reaches the keys whose names fit its last segment; one that
 * matches the output's messages.js or keys.js reaches every key; any other reaches none of grai's.
 * A glob matches files, so it reaches every key when it takes one of those modules in.
 */

import { dirname, join, relative } from "node:path";
import { globPattern } from "../globs.ts";
import type { ModuleGraph } from "./modules.ts";

/**
 * A key's name for a pattern's `*` to stand for, to resolve the pattern by: every key's path
 * resolves alike, by its directory, so any name tells where a pattern's paths go.
 */
const probe = "grai_probe_key";

/** The keys a pattern may reach: those that start with `prefix`, or none of grai's. */
export async function reachOfPattern(
	graph: ModuleGraph,
	pattern: string,
	importer: string,
): Promise<{ prefix: string; choices: undefined } | undefined> {
	const { keys, keyOf } = graph.output;
	const target = await graph.resolve(pattern.replaceAll("*", probe), importer);
	const segment = pattern.slice(pattern.lastIndexOf("/") + 1);
	const keyPath =
		target !== undefined && (target === keys || keyOf(target) !== undefined);
	if (keyPath && segment.includes("*")) {
		const directoryFits = !pattern
			.slice(0, pattern.lastIndexOf("/"))
			.includes("*");
		return {
			prefix: directoryFits ? segment.slice(0, segment.indexOf("*")) : "",
			choices: undefined,
		};
	}
	return globsTakeOutput(graph, [pattern], importer, "")
		? { prefix: "", choices: undefined }
		: undefined;
}

/**
 * Whether an `import.meta.glob`'s globs take one of the output's modules in: one glob matches it, as
 * Vite places a glob (from the importer, `/` from the project's root), and no `!` glob leaves it
 * out. A glob that starts with an alias is matched by what follows its first segment, from any
 * directory, as where the alias points is the bundler's.
 */
export function globsTakeOutput(
	{ output }: ModuleGraph,
	globs: readonly string[],
	importer: string,
	root: string,
): boolean {
	const from = dirname(importer);
	const placed = (glob: string) => {
		if (glob.startsWith("./") || glob.startsWith("../")) return glob;
		if (glob.startsWith("/")) return relativeTo(from, join(root, glob));
		return `**/${glob.slice(glob.indexOf("/") + 1)}`;
	};
	const left = globs.filter((glob) => glob.startsWith("!"));
	const taken = globs.filter((glob) => !glob.startsWith("!"));
	return [output.keys, output.messages].some((path) => {
		const shown = relativeTo(from, path);
		const matches = (glob: string) =>
			globPattern(placed(glob).replace(/^\.\//, "")).test(shown);
		return taken.some(matches) && !left.some((glob) => matches(glob.slice(1)));
	});
}

/** A path from a directory, written with `/` on every platform, as a glob writes one. */
function relativeTo(from: string, path: string): string {
	return relative(from, path).replaceAll("\\", "/");
}
