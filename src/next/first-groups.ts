// The groups of a Next app's keys for a `next dev` start that has none saved, as a fresh clone has:
// read beside the watch's first compile, which Next waits for then, on a thread of their own
// (`group-worker.ts`), and taken by the start's release (`startup.ts`) only when they come early.
//
// The thread reads the code at once. The groups need the output written, which the read resolves
// the app's imports of, so they come from a second read, once the compile has written it. Taking
// them costs the start that read, a save and one more compile; it saves the first page the shards
// it would compile in each layer that reads a key. On the bench's page, at 6,366 keys, Next waits
// 80 ms more and its first page comes 221–373 ms sooner; an app of 2,000 files takes longer to read
// than its catalogs to compile, and starts on its shards. A start cannot tell what the groups save
// its pages, so the rule is a heuristic, measured on those: take the groups when the code was read
// before the compile was done, and they come within the time the compile took again. That time
// counts any wait for the output's lock, and not the save and compile after it; a page that reads
// no key gains nothing from the wait. A start with groups saved never reads beside its compile.

import { extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { isKeyGroups, type KeyGroups } from "../saved-groups.ts";
import type { AppData } from "./app-data.ts";

/** The read of the groups, under way. */
export type FirstGroups = {
	/** Whether the code is read: settles true once it is, or false once the read failed or stopped. */
	read: Promise<boolean>;
	/**
	 * The groups, once the first compile is done in `compiled` ms and has written the output: by
	 * each key's weight, if the code was read already and they come within `compiled` ms more;
	 * otherwise none.
	 */
	after(
		weights: ReadonlyMap<string, number>,
		compiled: number,
	): Promise<KeyGroups | undefined>;
	/** Stops the read, and settles once its thread has stopped. */
	stop(): Promise<void>;
};

/** The read's module, beside this one and in its form: TypeScript in the sources, JavaScript built. */
const groupWorker = new URL(
	`./group-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

/** Starts reading the app's code for its groups, on a thread of its own running `script`. */
export function firstGroups(
	data: AppData,
	script: URL = groupWorker,
): FirstGroups {
	const worker = new Worker(script, { workerData: data, execArgv: [] });
	let isRead = false;
	let readSettled: (read: boolean) => void = () => {};
	const read = new Promise<boolean>((resolve) => {
		readSettled = resolve;
	});
	const answered = new Promise<KeyGroups | undefined>((resolve) => {
		worker.on("message", (message: unknown) => {
			if (message === "read") {
				isRead = true;
				readSettled(true);
				return;
			}
			readSettled(false);
			resolve(isKeyGroups(message) ? message : undefined);
		});
		// A read that stopped on an error it did not expect means no groups here; the watch's read once
		// the server is quiet meets it again, and says so.
		const ended = () => {
			readSettled(false);
			resolve(undefined);
		};
		worker.on("error", ended);
		worker.on("exit", ended);
	});
	return {
		read,
		async after(weights, compiled) {
			if (!isRead) return undefined;
			worker.postMessage(weights);
			const waiting = new AbortController();
			const late = delay(compiled, undefined, { signal: waiting.signal }).catch(
				() => undefined,
			);
			const groups = await Promise.race([answered, late]);
			waiting.abort();
			return groups;
		},
		async stop() {
			await worker.terminate();
		},
	};
}
