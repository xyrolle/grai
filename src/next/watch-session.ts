// The watch's session, once its thread has started what must start first (`watch-worker.ts`): the
// compiles, the start's release, and the groups of keys the app's routes read, once a session.
//
// When Next waits for the first compile and none are saved, as on a fresh clone, the groups are read
// beside it, and the keys placed by them if they come in time (`first-groups.ts`): the start's
// release alone (`startup.ts`) tells withGrai the output can be read. Otherwise they are read once
// the process is quiet after Next has started, and saved for the next start's compile; the output
// this server runs is left as it is, which Turbopack would otherwise compile again.
import { parentPort } from "node:worker_threads";
import type { Build } from "../compile.ts";
import { GraiError } from "../error.ts";
import { whenQuiet } from "../quiet.ts";
import { savedGroups, saveGroups } from "../saved-groups.ts";
import { watch } from "../watch.ts";
import type { AppData } from "./app-data.ts";
import { reportErrors } from "./errors.ts";
import type { FirstGroups } from "./first-groups.ts";
import { keyWeights, nextKeyGroups } from "./key-groups.ts";
import { startup } from "./startup.ts";

/**
 * Watches the app, whose output is `outdir`, with the groups `reading` reads beside the first
 * compile, if any, which it places the keys by only if Next waits for that compile (`held`).
 */
export function session(
	{ configFile, pageExtensions }: AppData,
	outdir: string,
	reading: FirstGroups | undefined,
	held: Promise<boolean>,
): void {
	/** Whether this session's groups are read, or being read. */
	let grouped = false;
	/** Whether Next may start, which only the start's release decides. */
	let released = false;

	/** Reads the groups once the process is quiet, once a session. */
	const regroupOnce = (build: Build) => {
		if (grouped) return;
		grouped = true;
		whenQuiet(() => {
			regroup(build, pageExtensions).catch((error: unknown) =>
				console.error(error),
			);
		});
	};

	const start = startup(reading, outdir, held);
	const watching = watch(
		configFile,
		(result, _milliseconds, build) => {
			reportErrors(result.errors);
			if (released && build !== undefined) regroupOnce(build);
		},
		// A compile that throws, as when the outdir cannot be written: the next save compiles again.
		(error) => console.error(error),
		{ placeFirst: start.placing },
	);
	start.released(watching).then(({ compiled, grouped: saved }) => {
		released = true;
		grouped ||= saved;
		// withGrai waits for this when the output is not current: the watch has started.
		parentPort?.postMessage("compiled");
		if ("build" in compiled && compiled.build !== undefined)
			regroupOnce(compiled.build);
	});
}

/** Saves the groups of the keys the app's routes read, when they are not those already saved. */
async function regroup(build: Build, extensions: string[]): Promise<void> {
	const groups = await nextKeyGroups(
		build.config,
		keyWeights(build.compilation),
		{ extensions },
	);
	if (groups instanceof GraiError) {
		reportErrors([groups]);
		return;
	}
	const { outdir } = build.config;
	if (JSON.stringify(groups) === JSON.stringify(savedGroups(outdir))) return;
	await saveGroups(outdir, groups);
}
