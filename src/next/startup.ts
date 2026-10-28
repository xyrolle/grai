// A `next dev` start's first compile and its release, when the groups are read beside it
// (`first-groups.ts`). The compile asks for them once it has compiled the catalogs (`placing`), and
// places the keys by them if they come in time (`placing.ts`), in the one output it writes, and
// saves them for the compiles after once that output is written. The start may go on once the
// watch has started (`released`, `Watch.first`: that compile has ended, and so has the compile of
// every edit that came meanwhile), and once withGrai has stopped the read's thread and it has
// stopped (`group-read.ts`). No compile after the first asks, so no output is written for the
// groups read once Next has started.
import type { Compilation } from "../compilation.ts";
import type { Placing } from "../placing.ts";
import { type KeyGroups, savedGroups } from "../saved-groups.ts";
import type { Compiled, Watch } from "../watch.ts";
import type { FirstGroups } from "./first-groups.ts";
import { keyWeights } from "./key-weights.ts";

/** How the start's last compile ended, and whether the groups read beside the first are saved. */
export type Started = { compiled: Compiled; grouped: boolean };

/** What the first compile asks for the groups, and the start's release. */
export type Startup = {
	placing: Placing | undefined;
	/** Settles once the watch has started, with whether the groups the first compile took are saved. */
	released: (watching: Watch) => Promise<Started>;
};

/**
 * The start of a watch whose first compile writes `outdir`, with the groups `reading` reads, if any,
 * which the compile places the keys by only if Next waits for it (`held`). The compile waits for
 * groups once the code is read, as only grouping the keys by their weights is left then
 * (`placing.ts`).
 */
export function startup(
	reading: FirstGroups | undefined,
	outdir: string,
	held: Promise<boolean>,
): Startup {
	/** The groups the compile was given. */
	let given: KeyGroups | undefined;
	let read = false;
	let waits = false;
	void reading?.read.then((done) => {
		read = done;
	});
	void held.then((waited) => {
		waits = waited;
	});
	const groupsFor = async (
		reading: FirstGroups,
		compilation: Compilation,
	): Promise<KeyGroups | undefined> => {
		if (!(await held)) return undefined;
		given = await reading.after(keyWeights(compilation));
		return given;
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
			// The compile saved the groups it was given if it wrote the output placed by them.
			const grouped =
				given !== undefined &&
				JSON.stringify(savedGroups(outdir)) === JSON.stringify(given);
			return { compiled, grouped };
		},
	};
}
