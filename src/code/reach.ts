/**
 * The keys a load by a pattern of paths may reach: a dynamic import by a template, which Vite
 * expands into a glob, or `import.meta.glob`. A pattern whose paths resolve, `*` standing for a
 * key's name, to a key's own module reaches the keys whose names fit its last segment; one that
 * matches the output's messages.js or keys.js reaches every key; any other reaches none of grai's.
 */

import { dirname, relative } from "node:path";
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
	const { keys, messages, keyOf } = graph.output;
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
	const glob = globPattern(pattern.replace(/^\.\//, ""));
	const output = [keys, messages].map((path) =>
		relative(dirname(importer), path).replaceAll("\\", "/"),
	);
	return output.some((path) => glob.test(path))
		? { prefix: "", choices: undefined }
		: undefined;
}
