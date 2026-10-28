import { Worker } from "node:worker_threads";
import { expect, it, onTestFinished, vi } from "vitest";
import { firstMessage } from "../src/next/first-message.ts";

// What withGrai waits for before Next starts, when the output is not current: the watch's first
// message, or the watch failing or stopping before it, which must not leave Next waiting.

/** Settles once a thread has stopped, its error or not. */
const exited = (worker: Worker) =>
	new Promise((resolve) => worker.once("exit", resolve));

const thread = (code: string) =>
	new Worker(
		`const { parentPort } = require("node:worker_threads");\n${code}`,
		{
			eval: true,
		},
	);

it("settles with a thread's first message", async () => {
	expect(
		await firstMessage(
			thread(`parentPort.postMessage("compiled");`),
			"a watch",
		),
	).toBe("compiled");
});

it("fails once a thread stops before its first message", async () => {
	await expect(firstMessage(thread(""), "a watch")).rejects.toThrow(
		"a watch stopped with exit code 0 before its first message",
	);
});

it("fails with the error a thread fails with before its first message", async () => {
	await expect(
		firstMessage(thread(`throw new Error("no config");`), "a watch"),
	).rejects.toThrow("no config");
});

it("keeps a first message, an exit or an error that came while its owner awaited other work", async () => {
	const posted = thread(`parentPort.postMessage("compiled");`);
	const message = firstMessage(posted, "a watch");
	await exited(posted);
	expect(await message).toBe("compiled");

	const ended = thread("");
	const exit = firstMessage(ended, "a watch");
	await exited(ended);
	await expect(exit).rejects.toThrow(
		"a watch stopped with exit code 0 before its first message",
	);

	const failing = thread(`throw new Error("no config");`);
	const error = firstMessage(failing, "a watch");
	await exited(failing);
	await expect(error).rejects.toThrow("no config");
});

it("prints an error a thread fails with after its first message", async () => {
	const printed = vi.spyOn(console, "error").mockImplementation(() => {});
	onTestFinished(() => printed.mockRestore());
	const failing = thread(
		`parentPort.postMessage("compiled");\nsetTimeout(() => { throw new Error("lost the outdir"); });`,
	);
	expect(await firstMessage(failing, "a watch")).toBe("compiled");
	await exited(failing);
	expect(printed).toHaveBeenCalledWith(
		expect.objectContaining({ message: "lost the outdir" }),
	);
});
