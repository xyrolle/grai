// The groups of a Next app's keys for a `next dev` start that has none saved, as a fresh clone has:
// read beside the watch's first compile, which Next waits for then, on a thread of their own
// (`group-worker.ts`), and taken only while that costs the start little against what it saves.
//
// The thread reads the code at once. The groups need the output written, which the read resolves
// the app's imports of, so they come after the compile: the start takes them when the code was read
// before the compile was done, and the groups then come within the time the compile took. The start
// then waits for them at most that long, and compiles once more to place the keys by them, where
// shards by a hash cost Next's first page every shard in each layer that reads a key: on the bench's
// page, 6,366 keys, about 30 ms of code read, 10 of grouping and 40 of placing, against 680 ms that
// shards cost the page. Otherwise the thread stops at once, so that it never takes the CPU from
// Next's first page, and the watch reads the groups once the server is quiet, for the next start.

import { extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { isKeyGroups, type KeyGroups } from "../saved-groups.ts";
import type { AppData } from "./app-data.ts";

/** The read of the groups, under way. */
export type FirstGroups = {
	/**
	 * The groups, once the first compile is done in `compiled` ms and has written the output: by
	 * each key's weight, if the code was read already and they come within `compiled` ms more;
	 * otherwise none. The read stops either way.
	 */
	after(
		weights: ReadonlyMap<string, number>,
		compiled: number,
	): Promise<KeyGroups | undefined>;
	/** Stops the read, as after a first compile that failed. */
	stop(): void;
};

/** The read's module, beside this one and in its form: TypeScript in the sources, JavaScript built. */
const groupWorker = new URL(
	`./group-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

/** Starts reading the app's code for its groups, on a thread of its own. */
export function firstGroups(data: AppData): FirstGroups {
	const worker = new Worker(groupWorker, { workerData: data, execArgv: [] });
	let read = false;
	const answered = new Promise<KeyGroups | undefined>((resolve) => {
		worker.on("message", (message: unknown) => {
			if (message === "read") read = true;
			else resolve(isKeyGroups(message) ? message : undefined);
		});
		// A read that stopped on an error it did not expect means no groups here; the watch's read once
		// the server is quiet meets it again, and says so.
		worker.on("error", () => resolve(undefined));
		worker.on("exit", () => resolve(undefined));
	});
	const stop = () => {
		void worker.terminate();
	};
	return {
		async after(weights, compiled) {
			if (!read) {
				stop();
				return undefined;
			}
			worker.postMessage(weights);
			const waiting = new AbortController();
			const late = delay(compiled, undefined, { signal: waiting.signal }).catch(
				() => undefined,
			);
			const groups = await Promise.race([answered, late]);
			waiting.abort();
			stop();
			return groups;
		},
		stop,
	};
}
