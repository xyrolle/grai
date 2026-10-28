import type { Compilation } from "../compilation.ts";

/**
 * Each key's weight: the length of its compiled code, which a module that holds it compiles. The
 * groups of keys are made by them (`key-groups.ts`), apart from the code reader, which the watch
 * loads only once it reads the groups.
 */
export function keyWeights(compilation: Compilation): Map<string, number> {
	return new Map(
		[...compilation.keys].map(([key, { value }]) => [key, value.length]),
	);
}
