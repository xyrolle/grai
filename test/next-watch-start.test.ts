import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel, Worker } from "node:worker_threads";
import { expect, it, onTestFinished, vi } from "vitest";
import { startGroupRead } from "../src/next/group-read.ts";
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
	const started = watchStarted(() => worker, check);
	await exited(worker);

	open(false);

	await expect(started).resolves.toBeUndefined();
});

it("fails Next's start once the watch stopped while the output was checked, before it had started", async () => {
	const worker = thread("");
	const { check, open } = gatedCheck();
	const started = watchStarted(() => worker, check);
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
	const started = watchStarted(() => worker, check);
	await exited(worker);

	open(true);

	await expect(started).resolves.toBeUndefined();
	await expect
		.poll(() => printed.mock.calls.flat())
		.toContainEqual(expect.objectContaining({ message: "no config" }));
});

it("prints an error the watch fails with while the read stops, and lets Next start once it has stopped", async () => {
	const printed = vi.spyOn(console, "error").mockImplementation(() => {});
	onTestFinished(() => printed.mockRestore());
	const worker = thread(`parentPort.once("message", () => {
	parentPort.postMessage("compiled");
	setTimeout(() => { throw new Error("lost the outdir"); });
});`);
	const stopping = Promise.withResolvers<void>();
	const stopped = Promise.withResolvers<void>();
	const read = {
		port: new MessageChannel().port1,
		stop: () => {
			stopping.resolve();
			return stopped.promise;
		},
	};
	const started = watchStarted(
		() => worker,
		async () => false,
		read,
	);
	await stopping.promise;
	await exited(worker);

	stopped.resolve();

	await expect(started).resolves.toBeUndefined();
	expect(printed.mock.calls.flat()).toContainEqual(
		expect.objectContaining({ message: "lost the outdir" }),
	);
});

it("stops the read, and waits for its thread to stop, before failing a start whose watch cannot be started", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grai-read-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "read.mjs");
	// A read that would go on for ever.
	writeFileSync(file, "setInterval(() => {}, 1000);\n");
	const thread = startGroupRead(
		{ configFile: join(dir, "grai.config.json"), pageExtensions: [] },
		pathToFileURL(file),
	);
	const order: string[] = [];
	const read = {
		port: thread.port,
		stop: async () => {
			await thread.stop();
			order.push("read stopped");
		},
	};

	const started = watchStarted(
		() => {
			throw new Error("no thread for the watch");
		},
		async () => false,
		read,
	).catch((error: unknown) => {
		order.push("failed");
		throw error;
	});

	await expect(started).rejects.toThrow("no thread for the watch");
	expect(order).toEqual(["read stopped", "failed"]);
});
