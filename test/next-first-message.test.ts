import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { firstMessage } from "../src/next/first-message.ts";

// What withGrai waits for before Next starts, when the output is not current: the watch's first
// message, or the watch failing or stopping before it, which must not leave Next waiting.

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
