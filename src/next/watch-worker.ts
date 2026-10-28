// The watch withGrai starts for `next dev`, on a thread of its own in Next's server process, so that
// its compiles never hold up Next's own work on the process's main thread: the first one, which takes
// up the build the last watcher saved while Next compiles the first page, and each edit's.
//
// withGrai starts this thread before it checks the output, and this module starts, before the
// watch's own modules load (`watch-session.ts`), the read of the groups beside the first compile,
// when none are saved (`first-groups.ts`): the earlier it starts, the likelier it is done when the
// compile asks for them. withGrai then says whether Next waits for that compile ("held" or
// "current"); a read for a start it does not wait for stops at once.
import { existsSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { groupsFile } from "../saved-groups.ts";
import { isAppData } from "./app-data.ts";
import { firstGroups } from "./first-groups.ts";

if (!isAppData(workerData)) {
	throw new TypeError(
		"grai's watch for next dev takes its config file's path and Next's page extensions",
	);
}
const app = workerData;
const outdir = configuredOutdir(app.configFile);
const reading =
	outdir !== undefined && !existsSync(groupsFile(outdir))
		? firstGroups(app)
		: undefined;
const held = new Promise<boolean>((resolve) => {
	parentPort?.once("message", (message: unknown) =>
		resolve(message === "held"),
	);
});
const { session } = await import("./watch-session.ts");
session(app, outdir ?? "", reading, held);

/** The outdir the config names, or none while the config cannot be read: the first compile says why. */
function configuredOutdir(configFile: string): string | undefined {
	try {
		return readConfig(configFile).outdir;
	} catch (error) {
		if (error instanceof GraiError) return undefined;
		throw error;
	}
}
