// The read of a Next app's code for the groups of its keys, on a thread of its own, which withGrai
// starts beside the watch's first compile when no groups are saved (`group-read.ts`), and which
// talks to the watch on a port of its own (`first-groups.ts`). It reads the code at once, through
// the output not written yet (`unwritten-output.ts`), and says so; once the compile has compiled
// the catalogs and sent each key's weight, it answers with the groups, in time for the compile to
// place the keys by them. It keeps the facts in memory and writes nothing: withGrai may stop it at
// any point, and a file it was writing would be left behind.
import { MessagePort, workerData } from "node:worker_threads";
import { memoryStore } from "../code/state-store.ts";
import { type Config, readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { type AppData, isAppData } from "./app-data.ts";
import { groupsOfCode } from "./key-groups.ts";

if (
	!isAppData(workerData) ||
	!("port" in workerData) ||
	!(workerData.port instanceof MessagePort)
) {
	throw new TypeError(
		"grai's read of the groups takes its config file's path, Next's page extensions, and the watch's port",
	);
}
const { port } = workerData;

/** What the read tells the watch: "read" once the code is read, then the groups, or "failed". */
const tell = (message: "read" | "failed" | string[][]) =>
	port.postMessage(message);

await readGroups(workerData);

/**
 * Reads the code, then gives the groups once the watch sends the weights. A config or code that
 * cannot be read only means no groups here: the watch's compile, or its read once the server is
 * quiet, says why.
 */
async function readGroups({ configFile, pageExtensions }: AppData) {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return tell("failed");
		throw error;
	}
	const grouping = await groupsOfCode(config, {
		extensions: pageExtensions,
		store: memoryStore(),
	});
	if (grouping instanceof GraiError) return tell("failed");
	port.once("message", async (weights: unknown) => {
		if (!isWeights(weights))
			throw new TypeError("grai's read of the groups takes each key's weight");
		tell(await grouping(weights));
	});
	tell("read");
}

function isWeights(value: unknown): value is Map<string, number> {
	return (
		value instanceof Map &&
		[...value].every(
			([key, weight]) => typeof key === "string" && typeof weight === "number",
		)
	);
}
