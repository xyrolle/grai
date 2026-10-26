/**
 * A worker of the pool (`pool.ts`): each task it is sent, answered in order. A file is read into the
 * text its facts are kept as (`keptText`), which the cache keeps as it is and which the pool parses
 * faster than it would take the facts themselves. An import is resolved by a resolver made once, as
 * a pool serves one project. The reader is loaded with the first file, so a worker that only
 * resolves starts without it.
 */

import { parentPort } from "node:worker_threads";
import type { Answer, Task } from "./pool.ts";
import { resolverFor } from "./resolution.ts";

let resolve: ReturnType<typeof resolverFor> | undefined;

parentPort?.on("message", async (task: Task) => {
	const answer: Answer = [];
	if (task.kind === "facts") {
		const [{ factsOf }, { keptText }] = await Promise.all([
			import("./facts.ts"),
			import("./facts-cache.ts"),
		]);
		for (const { path, text } of task.files) {
			answer.push(keptText(await factsOf(path, text)));
		}
	} else {
		resolve ??= resolverFor(task.resolution);
		for (const { source, importer } of task.imports) {
			answer.push(resolve(source, importer) ?? "");
		}
	}
	parentPort?.postMessage(answer);
});
