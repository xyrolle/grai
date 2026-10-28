// The read of a Next app's code for the groups of its keys, on a thread of its own, which the watch
// starts beside its first compile when no groups are saved (`first-groups.ts`). It reads the code at
// once, which keeps each file's facts, and says so; once the watch has written the output and sent
// each key's weight, it reads the code again, from those facts and now through the output, which the
// first read could not resolve an import of, and answers with the groups. It keeps the facts in
// memory and writes nothing: the watch may stop it at any point, and a file it was writing would be
// left behind.
import { parentPort, workerData } from "node:worker_threads";
import { readProjectCode } from "../code/project.ts";
import { memoryStore } from "../code/state-store.ts";
import { type Config, readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { type AppData, isAppData } from "./app-data.ts";
import { nextKeyGroups } from "./key-groups.ts";

/** What the read tells the watch: "read" once the code is read, then the groups, or "failed". */
const tell = (message: "read" | "failed" | string[][]) =>
	parentPort?.postMessage(message);

if (!isAppData(workerData)) {
	throw new TypeError(
		"grai's read of the groups takes its config file's path and Next's page extensions",
	);
}
await readGroups(workerData);

/**
 * Reads the code, then the groups once the watch sends the weights. A config or code that cannot be
 * read only means no groups here: the watch's compile, or its read once the server is quiet, says why.
 */
async function readGroups({ configFile, pageExtensions }: AppData) {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return tell("failed");
		throw error;
	}
	const store = memoryStore();
	const code = await readProjectCode(config, [config.root], {
		every: true,
		store,
	});
	if (code instanceof GraiError) return tell("failed");
	parentPort?.once("message", async (weights: unknown) => {
		if (!isWeights(weights))
			throw new TypeError("grai's read of the groups takes each key's weight");
		const groups = await nextKeyGroups(config, weights, {
			extensions: pageExtensions,
			store,
		});
		tell(groups instanceof GraiError ? "failed" : groups);
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
