import type { Worker } from "node:worker_threads";

/**
 * A thread's first message, heard from the call on: settles once the worker sends one, or fails
 * once it fails, or once it stops without sending one, so that what waits for it never waits for
 * ever. The thread is heard from the call, so a message, an error or an exit that comes while its
 * owner awaits other work is kept for it; a failure no one awaits yet is not taken for one no one
 * handles. Each error after the first message is printed, as a thread that stops on an error it did
 * not expect says so, and its owner goes on. `name` says whose thread it is, in that failure.
 */
export function firstMessage(worker: Worker, name: string): Promise<unknown> {
	const { promise, resolve, reject } = Promise.withResolvers<unknown>();
	let settled = false;
	const sent = (message: unknown) => {
		worker.off("message", sent);
		worker.off("exit", stopped);
		settled = true;
		resolve(message);
	};
	const stopped = (code: number) => {
		worker.off("message", sent);
		if (settled) return;
		settled = true;
		reject(
			new Error(
				`${name} stopped with exit code ${code} before its first message`,
			),
		);
	};
	worker.on("message", sent);
	worker.on("exit", stopped);
	worker.on("error", (error) => {
		if (settled) {
			console.error(error);
			return;
		}
		worker.off("message", sent);
		worker.off("exit", stopped);
		settled = true;
		reject(error);
	});
	promise.catch(() => {});
	return promise;
}
