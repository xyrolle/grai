/** Which modules pass grai's on, by the module graph: those that hold a key or more, or one key. */

import type { ModuleGraph } from "./modules.ts";

/** Whether a module passes grai's on: whether it holds a key or more, or this key. */
export function holding(
	graph: ModuleGraph,
	key: string | undefined,
): (path: string) => Promise<boolean> {
	return async (path) => {
		const held = await graph.keysHeld({ kind: "module", path });
		if (held === "every") return true;
		return key === undefined ? held.size > 0 : held.has(key);
	};
}

/** The sources that pass grai's on. */
export async function barrelsOf(
	paths: Iterable<string>,
	holds: (path: string) => Promise<boolean>,
): Promise<Set<string>> {
	const barrels = new Set<string>();
	for (const path of paths) {
		if (await holds(path)) barrels.add(path);
	}
	return barrels;
}
