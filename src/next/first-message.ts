import type { Worker } from "node:worker_threads";

/**
 * A thread's first message: settles once the worker sends one, or fails once it fails, or once it
 * stops without sending one, so that what waits for it never waits for ever. `name` says whose
 * thread it is, in that failure.
 */
export function firstMessage(worker: Worker, name: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const sent = (message: unknown) => {
			off();
			resolve(message);
		};
		const failed = (error: Error) => {
			off();
			reject(error);
		};
		const stopped = (code: number) => {
			off();
			reject(
				new Error(
					`${name} stopped with exit code ${code} before its first message`,
				),
			);
		};
		const off = () => {
			worker.off("message", sent);
			worker.off("error", failed);
			worker.off("exit", stopped);
		};
		worker.on("message", sent);
		worker.on("error", failed);
		worker.on("exit", stopped);
	});
}
