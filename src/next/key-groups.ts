// The keys a Next app's routes read together, in groups, for the output to hold each group in a
// module of its own: `next dev` then compiles, in each of its layers, the keys that layer's routes
// read and few modules more, where with shards by a hash it compiles every shard a page's keys fall
// in, which is all of them.

import { readProjectCode } from "../code/project.ts";
import { readingOf } from "../code/reads.ts";
import type { Compilation } from "../compilation.ts";
import type { Config } from "../config.ts";
import { GraiError } from "../error.ts";
import { keySets } from "../key-sets.ts";
import { keyContexts } from "./key-contexts.ts";
import { defaultPageExtensions, nextRoutes } from "./routes.ts";

/**
 * What one more module costs Turbopack in a layer that compiles it, in bytes of keys' code, which
 * is what the rest costs by: about 2.5 ms of CPU a module, and 50 µs a key of about 240 bytes in
 * three locales, from the Next bench (6,366 keys; `bench/nextjs.mjs`).
 */
const moduleCost = 12_000;

/** Each key's weight: the length of its compiled code, which a module that holds it compiles. */
export function keyWeights(compilation: Compilation): Map<string, number> {
	return new Map(
		[...compilation.keys].map(([key, { value }]) => [key, value.length]),
	);
}

/**
 * The groups of the keys the app's routes read, each sorted, in the order of their first key, from
 * each key's weight (`keyWeights`). A key's contexts are the sides of the routes that read it
 * (`keyContexts`): keys the same contexts read are a group, and two groups are one when the modules
 * that saves, in the contexts that read both, outweigh the code compiled for nothing in those that
 * read one. A key no route reads is in none.
 */
export async function nextKeyGroups(
	config: Config,
	weights: ReadonlyMap<string, number>,
	extensions: readonly string[] = defaultPageExtensions,
): Promise<string[][] | GraiError> {
	const code = await readProjectCode(config, [config.root], { every: true });
	if (code instanceof GraiError) return code;
	const contexts = await keyContexts(
		code,
		await readingOf(code),
		nextRoutes(config.root, extensions),
		[...weights.keys()],
	);
	const sets = keySets(
		[...contexts.of].map(([key, read]) => ({
			key,
			weight: weights.get(key) ?? 0,
			contexts: read,
			firstPaint: true,
		})),
		moduleCost,
	);
	return sets
		.map(({ keys }) => [...keys].sort())
		.sort(([a = ""], [b = ""]) => (a < b ? -1 : 1));
}
