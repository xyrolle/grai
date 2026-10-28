// Timing: batches of many runs, after a warm-up long enough for the JIT to finish tiering up
// thousands of message functions, each batch kept as a sample of nanoseconds an operation. Every
// result's length is summed and checked, so the engine cannot drop the work it measures. It imports
// nothing but the medians, so that a page bundles it too.
import { median } from "./medians.mjs";

function runFor(run, repeat) {
	let produced = 0;
	const start = performance.now();
	for (let r = 0; r < repeat; r++) produced += run().length;
	const ms = performance.now() - start;
	if (produced === 0)
		throw new Error(
			"The measured code produced nothing; it would time an empty loop.",
		);
	return ms;
}

/**
 * Nanoseconds an operation of `run`, which does `operations` operations each time, in each of
 * `samples` batches of at least `sampleMs`, taken after `warmupMs` of the same batches: every
 * sample, in the order taken.
 */
export function nanosecondSamples(
	run,
	operations = 1,
	{ samples = 31, sampleMs = 20, warmupMs = 1000 } = {},
) {
	let repeat = 1;
	while (runFor(run, repeat) < sampleMs) repeat *= 2;
	const warmupEnd = performance.now() + warmupMs;
	while (performance.now() < warmupEnd) runFor(run, repeat);
	return Array.from(
		{ length: samples },
		() => (runFor(run, repeat) * 1e6) / (repeat * operations),
	);
}

/** The median of `nanosecondSamples`, for a bench that reports one figure. */
export const nanosecondsPer = (run, operations, options) =>
	median(nanosecondSamples(run, operations, options));

export function formatNs(ns) {
	return ns < 10
		? ns.toFixed(2)
		: ns < 100
			? ns.toFixed(1)
			: Math.round(ns).toString();
}
