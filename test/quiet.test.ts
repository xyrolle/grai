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
