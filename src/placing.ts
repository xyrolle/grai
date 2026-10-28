/**
 * Groups for a compile to place the keys by, asked once the catalogs are compiled, in place of
 * those saved: an adapter that reads them beside the compile, as Next's watch does on a fresh clone
 * (`next/first-groups.ts`), gives them when it has them. The compile waits for groups the adapter
 * says are close (`waited`): its read of the code is done, and only grouping the keys by their
 * weights is left; the adapter can say so only after the turn of the event loop that takes in what
 * its thread told it while the compile ran, so it answers that later. It takes others if they have come when it asks, or else renders the keys by the
 * groups saved and takes them if they came meanwhile, rendering the keys again by them. Either way
 * it writes the output once.
 */

import type { Compilation } from "./compilation.ts";
import type { KeyGroups } from "./saved-groups.ts";

export type Placing = (compilation: Compilation) => Promise<Asked>;

/** The groups asked for, none for the groups saved, and whether the compile waits for them. */
export type Asked = { groups: Promise<KeyGroups | undefined>; waited: boolean };

/**
 * The groups asked for if they have come by now, a turn of the event loop included, so that an
 * answer a thread sent while this one worked is taken; else none. One that failed gives none.
 */
export async function cameBy(
	asked: Promise<KeyGroups | undefined>,
): Promise<KeyGroups | undefined> {
	let groups: KeyGroups | undefined;
	asked.then(
		(given) => {
			groups = given;
		},
		() => {},
	);
	await new Promise((resolve) => setImmediate(resolve));
	return groups;
}
