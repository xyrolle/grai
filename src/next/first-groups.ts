// The groups of a Next app's keys for a `next dev` start that has none saved, as a fresh clone has:
// read beside the watch's first compile, which Next waits for then, on a thread of their own
// (`group-worker.ts`), and taken by that compile (`startup.ts`) when they come in time.
//
// The thread reads the code at once, through the output not written yet (`unwritten-output.ts`).
// Once the compile has compiled the catalogs, it sends each key's weight, and takes the groups the
// thread answers if they have come by then, or come while it renders the keys by their shards,
// rendering them again by the groups (`placing.ts`); it writes the output once. Taking them costs
// the start that render at most; they save the first page the shards it would compile in each layer
// that reads a key. NUMBERS_TBD A start cannot tell what the groups save its pages, so the rule is a
// heuristic, measured on those: a page that reads no key gains nothing from them. A start with
// groups saved never reads beside its compile.

import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { isKeyGroups, type KeyGroups } from "../saved-groups.ts";
import type { AppData } from "./app-data.ts";

/** The read of the groups, under way. */
export type FirstGroups = {
	/** Whether the code is read: settles true once it is, or false once the read failed or stopped. */
	read: Promise<boolean>;
	/**
	 * The groups by each key's weight, once the code is read; none if the read failed or stopped
	 * first.
	 */
	after(weights: ReadonlyMap<string, number>): Promise<KeyGroups | undefined>;
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
	let readSettled: (read: boolean) => void = () => {};
	const read = new Promise<boolean>((resolve) => {
		readSettled = resolve;
	});
	const answered = new Promise<KeyGroups | undefined>((resolve) => {
		worker.on("message", (message: unknown) => {
			if (message === "read") {
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
		async after(weights) {
			if (!(await read)) return undefined;
			worker.postMessage(weights);
			return answered;
		},
		async stop() {
			await worker.terminate();
		},
	};
}
