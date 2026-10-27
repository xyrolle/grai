// The watch withGrai starts for `next dev`, on a thread of its own in Next's server process, so that
// its compiles never hold up Next's own work on the process's main thread: the first one, which takes
// up the build the last watcher saved while Next compiles the first page, and each edit's. Once the
// process is quiet after the first compile, it reads the app's code for the groups of keys its routes
// read (`key-groups.ts`) and saves them for the next start's compile; the output this server runs is
// left as it is, which Turbopack would otherwise compile again.
import { parentPort, workerData } from "node:worker_threads";
import type { Build } from "../compile.ts";
import { GraiError } from "../error.ts";
import { savedGroups, saveGroups } from "../saved-groups.ts";
import { watch } from "../watch.ts";
import { reportErrors } from "./errors.ts";
import { nextKeyGroups } from "./key-groups.ts";
import { whenQuiet } from "./quiet.ts";

/** What withGrai hands the watch: the grai config's path, and the extensions of Next's pages. */
export type WatchData = { configFile: string; pageExtensions: string[] };

const { configFile, pageExtensions } = watchData(workerData);

/** Whether withGrai was told the first compile is done, which it waits for when the output is not current. */
let told = false;
const tell = () => {
	if (told) return;
	told = true;
	parentPort?.postMessage("compiled");
};

/** Whether the groups are being read from the code, which happens once, after the first compile. */
let grouping = false;

watch(
	configFile,
	(result, _milliseconds, build) => {
		reportErrors(result.errors);
		tell();
		if (build === undefined || grouping) return;
		grouping = true;
		whenQuiet(() => {
			regroup(build).catch((error: unknown) => console.error(error));
		});
	},
	// A compile that throws, as when the outdir cannot be written: the next save compiles again.
	(error) => {
		console.error(error);
		tell();
	},
);

/** Saves the groups of the keys the app's routes read, when they are not those already saved. */
async function regroup(build: Build): Promise<void> {
	const groups = await nextKeyGroups(
		build.config,
		build.compilation,
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

function watchData(data: unknown): WatchData {
	if (
		typeof data === "object" &&
		data !== null &&
		"configFile" in data &&
		typeof data.configFile === "string" &&
		"pageExtensions" in data &&
		Array.isArray(data.pageExtensions) &&
		data.pageExtensions.every((extension) => typeof extension === "string")
	) {
		return { configFile: data.configFile, pageExtensions: data.pageExtensions };
	}
	throw new TypeError(
		"grai's watch for next dev takes its config file's path and Next's page extensions",
	);
}
