import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processCpuTime, whenQuiet } from "../src/quiet.ts";

describe("whenQuiet", () => {
	// The wall clock and the waits are the test's, and so is the CPU time read (`cpuAt`), so each
	// test sets how busy the process is and when, whatever else the machine runs.
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: [
				"setInterval",
				"clearInterval",
				"setTimeout",
				"clearTimeout",
				"performance",
			],
		});
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	/**
	 * A process's CPU time, which grows by `share` of a core from now on, until `busy` sets another
	 * share.
	 */
	function cpuAt(share: number) {
		let used = 0;
		let since = performance.now();
		const time = () => {
			const now = performance.now();
			used += (now - since) * share;
			since = now;
			return used;
		};
		const busy = (next: number) => {
			time();
			share = next;
		};
		return { time, busy };
	}

	/** A wait's `then`, which counts its calls. */
	function counted() {
		let calls = 0;
		return {
			call: () => {
				calls += 1;
			},
			calls: () => calls,
		};
	}

	it("calls once the process is quiet: at the end of the first half second it used under a tenth of a core", () => {
		const cpu = cpuAt(0.05);
		const { call, calls } = counted();
		whenQuiet(call, { cpuTime: cpu.time });

		vi.advanceTimersByTime(499);
		expect(calls()).toBe(0);
		vi.advanceTimersByTime(1);
		expect(calls()).toBe(1);
	});

	it("waits while another thread of the process works, and calls in the first half second after", () => {
		// Busy for 1.2 s, as Turbopack is compiling a page on its own threads.
		const cpu = cpuAt(1);
		const { call, calls } = counted();
		whenQuiet(call, { cpuTime: cpu.time });

		vi.advanceTimersByTime(1200);
		cpu.busy(0);
		// The half second ending at 1.5 s was busy for 200 ms of it, more than a tenth.
		vi.advanceTimersByTime(799);
		expect(calls()).toBe(0);
		vi.advanceTimersByTime(1);
		expect(calls()).toBe(1);
	});

	it("calls by its deadline while the process stays busy, and once", () => {
		const cpu = cpuAt(1);
		const { call, calls } = counted();
		whenQuiet(call, { deadline: 1000, cpuTime: cpu.time });

		vi.advanceTimersByTime(999);
		expect(calls()).toBe(0);
		vi.advanceTimersByTime(1);
		expect(calls()).toBe(1);
		cpu.busy(0);
		vi.advanceTimersByTime(5000);
		expect(calls()).toBe(1);
	});

	it("never calls once stopped", () => {
		const cpu = cpuAt(0);
		const { call, calls } = counted();
		const stop = whenQuiet(call, { deadline: 100, cpuTime: cpu.time });

		stop();
		vi.advanceTimersByTime(5000);

		expect(calls()).toBe(0);
	});
});

/** Work of a fixed size, its result returned so that none of it is left out. */
function work(): number {
	let sum = 0;
	for (let index = 0; index < 30_000_000; index += 1)
		sum = (sum + index * 7) % 1_000_003;
	return sum;
}

it("reads the CPU time of every thread of the process, another's while this one waits", async () => {
	// The work's CPU time on this thread, then on another while this one waits for it.
	const before = processCpuTime();
	const sum = work();
	const here = processCpuTime() - before;

	const start = processCpuTime();
	const worker = new Worker(
		`require("node:worker_threads").parentPort.postMessage((${work})());`,
		{ eval: true },
	);
	const [result] = await Promise.all([
		new Promise((resolve) => worker.once("message", resolve)),
		new Promise((resolve) => worker.once("exit", resolve)),
	]);
	const there = processCpuTime() - start;

	expect(result).toBe(sum);
	expect(there).toBeGreaterThan(here / 2);
});
