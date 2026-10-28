// When a `next dev` start may go on: once the watch's first compile has ended, with the keys placed
// by the groups read beside it if they came in time (`first-groups.ts`). This operation alone
// decides it, and owns the read's thread: it stops that thread and waits for it to stop, and places
// the keys, before it settles. A compile of an edit that ends meanwhile tells nothing, so no output
// is written for the groups once Next has started.
import { saveGroups } from "../saved-groups.ts";
import type { Compiled, Watch } from "../watch.ts";
import type { FirstGroups } from "./first-groups.ts";
import { keyWeights } from "./key-groups.ts";

/** How the start's compiles ended, and whether its keys are placed by the groups read beside it. */
export type Started = { compiled: Compiled; grouped: boolean };

/**
 * Settles once Next may start: after the first compile, and, with the groups read beside it, after
 * the compile that places the keys by them, its read again of a catalog mid-save included.
 */
export async function started(
	watching: Watch,
	reading: FirstGroups | undefined,
): Promise<Started> {
	const first = await watching.first;
	if (reading === undefined) return { compiled: first, grouped: false };
	const build = "result" in first ? first.build : undefined;
	let groups: readonly (readonly string[])[] | undefined;
	try {
		if (build !== undefined && "result" in first) {
			groups = await reading.after(
				keyWeights(build.compilation),
				first.milliseconds,
			);
		}
	} finally {
		await reading.stop();
	}
	if (build === undefined || groups === undefined)
		return { compiled: first, grouped: false };
	await saveGroups(build.config.outdir, groups);
	return { compiled: await watching.compileAgain(), grouped: true };
}
