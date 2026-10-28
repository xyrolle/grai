// When `next dev` may start, as the watch withGrai starts on a thread of its own tells it
// (`config.ts`, `watch-worker.ts`).
import type { Worker } from "node:worker_threads";
import { firstMessage } from "./first-message.ts";

/**
 * Settles once Next may start, the watch's thread `worker` started: at once when the output is
 * current (`check`), so that Next starts while the watch's first compile builds what each edit after
 * it starts from, and else once the watch says it has started, having written the output; it fails
 * if the watch fails or stops first, as Next would otherwise wait for it for ever. The thread is heard
 * from the call (`firstMessage`), so that its word, failure or exit while the output is checked is
 * kept. A watch that fails when Next does not wait for it, and one that stops on an error it did not
 * expect later, says so, and Next serves on.
 */
export async function watchStarted(
	worker: Worker,
	check: () => Promise<boolean>,
): Promise<void> {
	const first = firstMessage(worker, "grai's watch");
	const compiled = await check();
	worker.postMessage(compiled ? "current" : "held");
	if (!compiled) await first;
	else first.catch((error: unknown) => console.error(error));
}
