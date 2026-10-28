import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { whenQuiet } from "../src/quiet.ts";

it("waits while another thread of the process works, and runs once the process is quiet", async () => {
	// A thread that keeps a core busy for a second and a half, as Turbopack does compiling a page.
	const busy = new Worker(
		"const end = Date.now() + 1500; while (Date.now() < end) {}",
		{ eval: true },
	);
	const finished = new Promise<number>((resolve) =>
		busy.on("exit", () => resolve(performance.now())),
	);

	const ran = await new Promise<number>((resolve) =>
		whenQuiet(() => resolve(performance.now())),
	);

	expect(ran).toBeGreaterThanOrEqual(await finished);
});

it("runs by its deadline while the process stays busy", async () => {
	// A thread that keeps a core busy for longer than the deadline.
	const busy = new Worker(
		"const end = Date.now() + 3000; while (Date.now() < end) {}",
		{ eval: true },
	);
	const started = performance.now();

	const ran = await new Promise<number>((resolve) =>
		whenQuiet(() => resolve(performance.now()), { deadline: 1000 }),
	);
	await busy.terminate();

	expect(ran - started).toBeGreaterThanOrEqual(1000);
	expect(ran - started).toBeLessThan(2500);
});

it("never runs once stopped", async () => {
	let ran = false;
	const stop = whenQuiet(
		() => {
			ran = true;
		},
		{ deadline: 100 },
	);
	stop();
	await new Promise((resolve) => setTimeout(resolve, 700));

	expect(ran).toBe(false);
});
