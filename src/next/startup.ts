// A `next dev` start's first compile and its release, when the groups are read beside it
// (`first-groups.ts`). The compile asks for them once it has compiled the catalogs (`placing`), and
// places the keys by them if they come in time (`placing.ts`), in the one output it writes; they
// are saved for the starts after. The start may go on once that compile has ended and the read's
// thread has stopped (`released`): a compile of an edit that ends meanwhile releases nothing, and
// no compile after the first asks, so no output is written for the groups read once Next has
// started.
import type { Compilation } from "../compilation.ts";
import type { Placing } from "../placing.ts";
import { type KeyGroups, saveGroups } from "../saved-groups.ts";
import type { Compiled, Watch } from "../watch.ts";
import type { FirstGroups } from "./first-groups.ts";
import { keyWeights } from "./key-groups.ts";

/** How the start's first compile ended, and whether the groups read beside it were saved. */
export type Started = { compiled: Compiled; grouped: boolean };

/** What the first compile asks for the groups, and the start's release. */
export type Startup = {
	placing: Placing | undefined;
	/** Settles once Next may start: the first compile has ended, and the read's thread has stopped. */
	released: (watching: Watch) => Promise<Started>;
};

/**
 * The start of a watch whose first compile writes `outdir`, with the groups `reading` reads, if any,
 * which the compile places the keys by only if Next waits for it (`held`): a read for a start Next
 * does not wait for stops at once. The compile waits for groups once the code is read, as only
 * grouping the keys by their weights is left then (`placing.ts`).
 */
export function startup(
	reading: FirstGroups | undefined,
	outdir: string,
	held: Promise<boolean>,
): Startup {
	/** The save of the groups the compile was given, which the start waits for. */
	let saving: Promise<boolean> = Promise.resolve(false);
	let read = false;
	let waits = false;
	void reading?.read.then((done) => {
		read = done;
	});
	void held.then((waited) => {
		waits = waited;
		if (!waited) return reading?.stop();
	});
	const groupsFor = async (
		reading: FirstGroups,
		compilation: Compilation,
	): Promise<KeyGroups | undefined> => {
		if (!(await held)) return undefined;
		const groups = await reading.after(keyWeights(compilation));
		// Given to the compile at once; the save goes on beside it.
		if (groups !== undefined) saving = saved(outdir, groups);
		return groups;
	};
	return {
		placing:
			reading &&
			(async (compilation) => {
				// A turn of the event loop takes in the read's word that it is done, which came while the
				// compile ran.
				await new Promise((resolve) => setImmediate(resolve));
				return {
					groups: groupsFor(reading, compilation),
					waited: read && waits,
				};
			}),
		released: async (watching) => {
			const compiled = await watching.first;
			await reading?.stop();
			return { compiled, grouped: await saving };
		},
	};
}

/** Saves the groups for the starts after; whether they were. */
async function saved(outdir: string, groups: KeyGroups): Promise<boolean> {
	try {
		await saveGroups(outdir, groups);
		return true;
	} catch (error) {
		// Groups the next start cannot read: its watch reads them again once the server is quiet.
		console.error(error);
		return false;
	}
}
