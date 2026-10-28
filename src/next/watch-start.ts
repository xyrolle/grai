// When `next dev` may start, as the watch withGrai starts on a thread of its own tells it
// (`config.ts`, `watch-worker.ts`).
import type { Worker } from "node:worker_threads";
import { firstMessage } from "./first-message.ts";
import type { GroupRead } from "./group-read.ts";

/**
 * Settles once Next may start, with the watch's thread started (`start`) beside the read of the
 * groups, if any: at once when the output is current (`check`), so that Next starts while the
 * watch's first compile builds what each edit after it starts from, and else once the watch says it
 * has started, having written the output; it fails if the watch fails or stops first, or cannot be
 * started, as Next would otherwise wait for it for ever. Either way it settles once it has stopped
 * the read and the read's thread has stopped, so that the read never takes Next's CPU nor outlives
 * a start that failed. The watch's thread is heard from its start (`firstMessage`), so that its
 * word, failure or exit while the output is checked, or while the read stops, is kept. A watch that
 * fails when Next does not wait for it, and one that stops on an error it did not expect later,
 * says so, and Next serves on.
 */
export async function watchStarted(
	start: () => Worker,
	check: () => Promise<boolean>,
	read?: GroupRead,
): Promise<void> {
	try {
		const worker = start();
		const first = firstMessage(worker, "grai's watch");
		const compiled = await check();
		worker.postMessage(compiled ? "current" : "held");
		if (!compiled) await first;
		else first.catch((error: unknown) => console.error(error));
	} finally {
		await read?.stop();
	}
}
