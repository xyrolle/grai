// The watch withGrai starts for `next dev`, on a thread of its own in Next's server process, so that
// its compiles never hold up Next's own work on the process's main thread: the first one, which takes
// up the build the last watcher saved while Next compiles the first page, and each edit's.
//
// The groups of keys the app's routes read (`key-groups.ts`) are read once a session. When Next waits
// for the first compile and none are saved, as on a fresh clone, they are read beside it, on the
// thread withGrai starts for them (`group-read.ts`), which the watch hears on a port, and the keys
// placed by them if they come in time (`first-groups.ts`). withGrai says whether Next waits for that
// compile ("held" or "current"), and the start's release alone (`startup.ts`) tells it the watch
// has started. Otherwise the groups are read once the process is quiet after Next has started,
// and saved for the next start's compile; the output this server runs is left as it is, which
// Turbopack would otherwise compile again.
import { MessagePort, parentPort, workerData } from "node:worker_threads";
import type { Build } from "../compile.ts";
import { readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { whenQuiet } from "../quiet.ts";
import { savedGroups, saveGroups } from "../saved-groups.ts";
import { watch } from "../watch.ts";
import { type AppData, isAppData } from "./app-data.ts";
import { reportErrors } from "./errors.ts";
import { firstGroups } from "./first-groups.ts";
import { keyWeights } from "./key-weights.ts";
import { startup } from "./startup.ts";

/** What withGrai hands the watch: the app's, and the port of the read of the groups, if any. */
export type WatchData = AppData & { groups?: MessagePort };

const { configFile, pageExtensions, groups } = watchData(workerData);
const held = new Promise<boolean>((resolve) => {
	parentPort?.once("message", (message: unknown) =>
		resolve(message === "held"),
	);
});

/** Whether this session's groups are read, or being read. */
let grouped = false;
/** Whether Next may start, which only the start's release decides. */
let released = false;

const start = startup(
	groups === undefined ? undefined : firstGroups(groups),
	configuredOutdir() ?? "",
	held,
);
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

/** Reads the groups once the process is quiet, once a session. */
function regroupOnce(build: Build): void {
	if (grouped) return;
	grouped = true;
	whenQuiet(() => {
		regroup(build).catch((error: unknown) => console.error(error));
	});
}

/**
 * Saves the groups of the keys the app's routes read, when they are not those already saved. The
 * code reader loads then, once the server is quiet, and not before the first compile.
 */
async function regroup(build: Build): Promise<void> {
	const { nextKeyGroups } = await import("./key-groups.ts");
	const groups = await nextKeyGroups(
		build.config,
		keyWeights(build.compilation),
		{ extensions: pageExtensions },
	);
	if (groups instanceof GraiError) {
		reportErrors([groups]);
		return;
	}
	const { outdir } = build.config;
	if (JSON.stringify(groups) === JSON.stringify(savedGroups(outdir))) return;
	await saveGroups(outdir, groups);
}

/** The outdir the config names, or none while the config cannot be read: the first compile says why. */
function configuredOutdir(): string | undefined {
	try {
		return readConfig(configFile).outdir;
	} catch (error) {
		if (error instanceof GraiError) return undefined;
		throw error;
	}
}

function watchData(data: unknown): WatchData {
	if (!isAppData(data)) {
		throw new TypeError(
			"grai's watch for next dev takes its config file's path and Next's page extensions",
		);
	}
	const { configFile, pageExtensions } = data;
	if (!("groups" in data)) return { configFile, pageExtensions };
	if (!(data.groups instanceof MessagePort))
		throw new TypeError("grai's watch hears the read of the groups on a port");
	return { configFile, pageExtensions, groups: data.groups };
}
