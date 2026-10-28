import { performance } from "node:perf_hooks";

/**
 * When the process is quiet: a window of `quietMilliseconds` in which its event loop worked less
 * than `quietShare` of the time. A dev server keeps its loop busy while it starts and while it
 * answers a page's requests, and hardly at all while it waits for an edit.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/**
 * Calls `then` once the process is quiet, unless the function it returns is called first. The wait
 * keeps no process alive.
 */
export function whenQuiet(then: () => void): () => void {
	let since = performance.eventLoopUtilization();
	const timer = setInterval(() => {
		const window = performance.eventLoopUtilization(since);
		since = performance.eventLoopUtilization();
		if (window.utilization >= quietShare) return;
		clearInterval(timer);
		then();
	}, quietMilliseconds);
	timer.unref();
	return () => clearInterval(timer);
}
