// The groups of a Next app's keys for a `next dev` start that has none saved, as a fresh clone has:
// read beside the watch's first compile, which Next waits for then, on a thread of their own that
// withGrai starts first (`group-read.ts`), and taken by that compile (`startup.ts`) when they come in
// time. This is the watch's side of that thread: the port it talks to it on.
//
// The thread reads the code at once, through the output not written yet (`unwritten-output.ts`).
// Once the compile has compiled the catalogs, it sends each key's weight: if the code is read by
// then, it waits for the groups, as only grouping the keys by their weights is left; if not, it
// renders the keys by their shards meanwhile, and takes the groups if they came during that render,
// rendering the keys again by them (`placing.ts`). It writes the output once. Taking the groups
// costs the start that grouping, or that render; they save the first page the shards it would
// compile in each layer that reads a key. On the bench's page every fresh start waited for them,
// as the read was done when the catalogs were. A start cannot tell what the groups save its pages,
// so the rule is a heuristic, measured on those: a page that reads no key gains nothing from them.
// A start with groups saved never reads beside its compile.

import type { MessagePort } from "node:worker_threads";
import { isKeyGroups, type KeyGroups } from "../saved-groups.ts";

/** The read of the groups, under way. */
export type FirstGroups = {
	/** Whether the code is read: settles true once it is, or false once the read failed or stopped. */
	read: Promise<boolean>;
	/**
	 * The groups by each key's weight, once the code is read; none if the read failed or stopped
	 * first.
	 */
	after(weights: ReadonlyMap<string, number>): Promise<KeyGroups | undefined>;
};

/** The read whose thread answers on `port`; its port closes once the thread has stopped. */
export function firstGroups(port: MessagePort): FirstGroups {
	let readSettled: (read: boolean) => void = () => {};
	const read = new Promise<boolean>((resolve) => {
		readSettled = resolve;
	});
	const answered = new Promise<KeyGroups | undefined>((resolve) => {
		port.on("message", (message: unknown) => {
			if (message === "read") {
				readSettled(true);
				return;
			}
			readSettled(false);
			resolve(isKeyGroups(message) ? message : undefined);
		});
		port.on("close", () => {
			readSettled(false);
			resolve(undefined);
		});
	});
	return {
		read,
		async after(weights) {
			if (!(await read)) return undefined;
			port.postMessage(weights);
			return answered;
		},
	};
}
