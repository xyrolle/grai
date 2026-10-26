// The watch withGrai starts for `next dev`, on a thread of its own in Next's server process, so that
// its compiles never hold up Next's own work on the process's main thread: the first one, which takes
// up the build the last watcher saved while Next compiles the first page, and each edit's.
import { parentPort, workerData } from "node:worker_threads";
import { watch } from "../watch.ts";
import { reportErrors } from "./errors.ts";

const configFile: unknown = workerData;
if (typeof configFile !== "string") {
	throw new TypeError("grai's watch for next dev takes its config file's path");
}

/** Whether withGrai was told the first compile is done, which it waits for when the output is not current. */
let told = false;
const tell = () => {
	if (told) return;
	told = true;
	parentPort?.postMessage("compiled");
};

watch(
	configFile,
	(result) => {
		reportErrors(result.errors);
		tell();
	},
	// A compile that throws, as when the outdir cannot be written: the next save compiles again.
	(error) => {
		console.error(error);
		tell();
	},
);
