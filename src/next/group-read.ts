// The thread that reads a Next app's code for the groups of its keys (`group-worker.ts`), which
// withGrai starts first thing on a start that has none saved, before the watch's thread and the
// check of the output: the earlier it starts, the likelier it is done when the watch's first
// compile asks for the groups (`first-groups.ts`). The watch talks to it on a port of its own;
// withGrai stops it, and waits for it to stop, before Next may start.
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, type MessagePort, Worker } from "node:worker_threads";
import type { AppData } from "./app-data.ts";

/** The read's thread: the port the watch talks to it on, and its stop. */
export type GroupRead = {
	port: MessagePort;
	/** Stops the read, and settles once its thread has stopped. */
	stop(): Promise<void>;
};

/** The read's module, beside this one and in its form: TypeScript in the sources, JavaScript built. */
const groupWorker = new URL(
	`./group-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

/** Starts reading the app's code for its groups, on a thread of its own running `script`. */
export function startGroupRead(
	data: AppData,
	script: URL = groupWorker,
): GroupRead {
	const { port1, port2 } = new MessageChannel();
	const worker = new Worker(script, {
		workerData: { ...data, port: port1 },
		transferList: [port1],
		execArgv: [],
	});
	// A read that stops on an error it did not expect closes its port, which the watch takes for no
	// groups; the watch's read once the server is quiet meets the error again, and says so.
	worker.on("error", () => {});
	return {
		port: port2,
		stop: async () => {
			await worker.terminate();
		},
	};
}
