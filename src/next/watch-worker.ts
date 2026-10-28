// The watch withGrai starts for `next dev`, on a thread of its own in Next's server process, so that
// its compiles never hold up Next's own work on the process's main thread: the first one, which takes
// up the build the last watcher saved while Next compiles the first page, and each edit's.
//
// The groups of keys the app's routes read (`key-groups.ts`) are read once a session. When Next waits
// for the first compile and none are saved, as on a fresh clone, they are read beside it, and the
// keys placed by them before Next starts if that costs the start little (`first-groups.ts`).
// Otherwise they are read once the process is quiet after the first compile, and saved for the next
// start's compile; the output this server runs is left as it is, which Turbopack would otherwise
// compile again.
import { existsSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import type { Build } from "../compile.ts";
import { readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { groupsFile, savedGroups, saveGroups } from "../saved-groups.ts";
import { watch } from "../watch.ts";
import { type AppData, isAppData } from "./app-data.ts";
import { reportErrors } from "./errors.ts";
import { type FirstGroups, firstGroups } from "./first-groups.ts";
import { keyWeights, nextKeyGroups } from "./key-groups.ts";
import { whenQuiet } from "./quiet.ts";

/** What withGrai hands the watch: the app's, and whether Next waits for the first compile. */
export type WatchData = AppData & { held: boolean };

const data = watchData(workerData);
const { configFile, pageExtensions } = data;

/** Whether withGrai was told the first compile is done, which it waits for when the output is not current. */
let told = false;
const tell = () => {
	if (told) return;
	told = true;
	parentPort?.postMessage("compiled");
};

/** The read of the groups beside the first compile, until that compile is done. */
let first: FirstGroups | undefined = groupsWanted()
	? firstGroups({ configFile, pageExtensions })
	: undefined;

/** Whether this session's groups are read, or being read. */
let grouped = false;

const watcher = watch(
	configFile,
	(result, milliseconds, build) => {
		reportErrors(result.errors);
		const reading = first;
		first = undefined;
		if (reading === undefined || build === undefined) {
			reading?.stop();
			settled(build);
			return;
		}
		placed(reading, build, milliseconds).catch((error: unknown) => {
			console.error(error);
			settled(build);
		});
	},
	// A compile that throws, as when the outdir cannot be written: the next save compiles again.
	(error) => {
		console.error(error);
		first?.stop();
		first = undefined;
		tell();
	},
);

/**
 * Places the keys by the groups read beside the first compile, if they come in time, by compiling
 * again with them saved; then tells withGrai.
 */
async function placed(
	reading: FirstGroups,
	build: Build,
	milliseconds: number,
): Promise<void> {
	const groups = await reading.after(
		keyWeights(build.compilation),
		milliseconds,
	);
	if (groups === undefined) {
		settled(build);
		return;
	}
	grouped = true;
	await saveGroups(build.config.outdir, groups);
	await watcher.compileAgain();
	tell();
}

/** Tells withGrai the output can be read, and reads the groups once the process is quiet, once. */
function settled(build: Build | undefined): void {
	tell();
	if (build === undefined || grouped) return;
	grouped = true;
	whenQuiet(() => {
		regroup(build).catch((error: unknown) => console.error(error));
	});
}

/** Saves the groups of the keys the app's routes read, when they are not those already saved. */
async function regroup(build: Build): Promise<void> {
	const groups = await nextKeyGroups(
		build.config,
		keyWeights(build.compilation),
		pageExtensions,
	);
	if (groups instanceof GraiError) {
		reportErrors([groups]);
		return;
	}
	const { outdir } = build.config;
	if (JSON.stringify(groups) === JSON.stringify(savedGroups(outdir))) return;
	await saveGroups(outdir, groups);
}

/** Whether the groups are read beside the first compile: Next waits for it, and none are saved. */
function groupsWanted(): boolean {
	if (!data.held) return false;
	try {
		return !existsSync(groupsFile(readConfig(configFile).outdir));
	} catch (error) {
		// A config that cannot be read fails the first compile, which says why.
		if (error instanceof GraiError) return false;
		throw error;
	}
}

function watchData(data: unknown): WatchData {
	if (isAppData(data) && "held" in data && typeof data.held === "boolean") {
		return { ...data, held: data.held };
	}
	throw new TypeError(
		"grai's watch for next dev takes its config file's path, Next's page extensions, and whether Next waits for its first compile",
	);
}
