/**
 * When the process is quiet: a window of `quietMilliseconds` in which all its threads together used
 * less than `quietShare` of one core's time. A dev server is busy while it starts and while it
 * answers a page's requests, and hardly at all while it waits for an edit; its bundler, as
 * Turbopack or Rolldown, works on threads of its own, which the thread that waits cannot tell from
 * its own event loop.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/** The CPU time the process has used, in milliseconds: every thread's, in user and system mode. */
export function processCpuTime(): number {
	const { user, system } = process.cpuUsage();
	return (user + system) / 1000;
}

/**
 * Calls `then` once the process is quiet, or once `deadline` milliseconds have passed if one is
 * given, unless the function it returns is called first. The wait keeps no process alive. The CPU
 * time it reads is the process's (`processCpuTime`), unless `cpuTime` gives another.
 */
export function whenQuiet(
	then: () => void,
	{
		deadline,
		cpuTime = processCpuTime,
	}: { deadline?: number; cpuTime?: () => number } = {},
): () => void {
	let used = cpuTime();
	let at = performance.now();
	const timer = setInterval(() => {
		const usedNow = cpuTime();
		const now = performance.now();
		const share = (usedNow - used) / (now - at);
		used = usedNow;
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
