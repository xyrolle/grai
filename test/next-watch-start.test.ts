import { Worker } from "node:worker_threads";
import { expect, it, onTestFinished, vi } from "vitest";
import { watchStarted } from "../src/next/watch-start.ts";

// When `next dev` may start, as the watch tells withGrai (`watch-start.ts`): the watch's thread is
// heard from its start, so what it says, or how it fails or stops, while the output is checked
// is kept, and Next neither waits for ever nor misses a failure.

const thread = (code: string) =>
	new Worker(
		`const { parentPort } = require("node:worker_threads");\n${code}`,
		{ eval: true },
	);

/** Settles once a thread has stopped, its error or not. */
const exited = (worker: Worker) =>
	new Promise((resolve) => worker.once("exit", resolve));

/** An output check that answers once the test opens it. */
function gatedCheck() {
	const gate = Promise.withResolvers<boolean>();
	return { check: () => gate.promise, open: gate.resolve };
}

it("lets Next start once the watch has started, though it said so while the output was checked", async () => {
	const worker = thread(`parentPort.postMessage("compiled");`);
	const { check, open } = gatedCheck();
	const started = watchStarted(worker, check);
	await exited(worker);

	open(false);

	await expect(started).resolves.toBeUndefined();
});

it("fails Next's start once the watch stopped while the output was checked, before it had started", async () => {
	const worker = thread("");
	const { check, open } = gatedCheck();
	const started = watchStarted(worker, check);
	await exited(worker);

	open(false);

	await expect(started).rejects.toThrow(
		"grai's watch stopped with exit code 0 before its first message",
	);
});

it("lets Next start on a current output, and prints how a watch that failed while the output was checked failed", async () => {
	const printed = vi.spyOn(console, "error").mockImplementation(() => {});
	onTestFinished(() => printed.mockRestore());
	const worker = thread(`throw new Error("no config");`);
	const { check, open } = gatedCheck();
	const started = watchStarted(worker, check);
	await exited(worker);

	open(true);

	await expect(started).resolves.toBeUndefined();
	await expect
		.poll(() => printed.mock.calls.flat())
		.toContainEqual(expect.objectContaining({ message: "no config" }));
});
