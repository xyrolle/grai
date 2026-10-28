import { performance } from "node:perf_hooks";

/**
 * When the process is quiet: a window of `quietMilliseconds` in which all its threads together used
 * less than `quietShare` of one core's time. A dev server is busy while it starts and while it
 * answers a page's requests, and hardly at all while it waits for an edit; its bundler, as
 * Turbopack or Rolldown, works on threads of its own, which the thread that waits cannot tell from
 * its own event loop.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/**
 * Calls `then` once the process is quiet, or once `deadline` milliseconds have passed if one is
 * given, unless the function it returns is called first. The wait keeps no process alive.
 */
export function whenQuiet(
	then: () => void,
	{ deadline }: { deadline?: number } = {},
): () => void {
	let used = process.cpuUsage();
	let at = performance.now();
	const timer = setInterval(() => {
		const { user, system } = process.cpuUsage(used);
		const now = performance.now();
		const share = (user + system) / 1000 / (now - at);
		used = process.cpuUsage();
		at = now;
		if (share < quietShare) call();
	}, quietMilliseconds);
	timer.unref();
	const late =
		deadline === undefined ? undefined : setTimeout(() => call(), deadline);
	late?.unref();
	function stop() {
		clearInterval(timer);
		clearTimeout(late);
	}
	function call() {
		stop();
		then();
	}
	return stop;
}
