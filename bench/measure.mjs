// Timing: the median of many rounds, after a warm-up long enough for the JIT to finish tiering up
// thousands of message functions. Every result's length is summed and checked, so the engine
// cannot drop the work it measures.
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

/** Median nanoseconds per operation of `run`, which does `operations` operations each time. */
export function nanosecondsPer(
	run,
	operations = 1,
	{ rounds = 31, roundMs = 20, warmupMs = 1000 } = {},
) {
	let repeat = 1;
	while (runFor(run, repeat) < roundMs) repeat *= 2;
	const warmupEnd = performance.now() + warmupMs;
	while (performance.now() < warmupEnd) runFor(run, repeat);
	const samples = [];
	for (let round = 0; round < rounds; round++)
		samples.push((runFor(run, repeat) * 1e6) / (repeat * operations));
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
}

export function formatNs(ns) {
	return ns < 10
		? ns.toFixed(2)
		: ns < 100
			? ns.toFixed(1)
			: Math.round(ns).toString();
}
