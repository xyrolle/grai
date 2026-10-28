import { performance } from "node:perf_hooks";

/**
 * When Next's server process is quiet: a window of `quietMilliseconds` in which all its threads
 * together used less than `quietShare` of one core's time. Turbopack compiles a page on threads of
 * its own, so the watch's thread, idle meanwhile, cannot tell from its own event loop.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/**
 * Calls `run` once, as soon as the process is quiet: after `next dev` has compiled and served the
 * pages it was asked for, so that work of grai's own never takes their threads.
 */
export function whenQuiet(run: () => void): void {
	let used = process.cpuUsage();
	let at = performance.now();
	const timer = setInterval(() => {
		const { user, system } = process.cpuUsage(used);
		const now = performance.now();
		const share = (user + system) / 1000 / (now - at);
		used = process.cpuUsage();
		at = now;
		if (share >= quietShare) return;
		clearInterval(timer);
		run();
	}, quietMilliseconds);
	timer.unref();
}
