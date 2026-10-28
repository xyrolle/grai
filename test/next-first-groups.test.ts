import { once } from "node:events";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { expect, it, onTestFinished } from "vitest";
import { readConfig } from "../src/config.ts";
import { firstGroups } from "../src/next/first-groups.ts";
import { nextKeyGroups } from "../src/next/key-groups.ts";
import { freshApp } from "./next-fresh-app.ts";

// The groups of a fresh app's keys read beside the first compile of its `next dev` start
// (`first-groups.ts`): what the read answers, once the compile has written the output its first read
// could not resolve, what a start gets from it, and that stopping it leaves nothing behind.

/** A thread's script of the test's own, in a module file, removed after the test. */
function script(code: string): URL {
	const dir = mkdtempSync(join(tmpdir(), "grai-read-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "read.mjs");
	writeFileSync(
		file,
		`import { parentPort } from "node:worker_threads";\n${code}\n`,
	);
	return pathToFileURL(file);
}

it("reads the code before the output is written, then the groups through the output once it is, from each key's weight, and writes nothing", async () => {
	const { dir, data, compiled } = freshApp();
	const worker = new Worker(
		new URL("../src/next/group-worker.ts", import.meta.url),
		{ workerData: data, execArgv: [] },
	);
	onTestFinished(async () => {
		await worker.terminate();
	});

	expect(await once(worker, "message")).toEqual(["read"]);
	worker.postMessage(await compiled());

	expect(await once(worker, "message")).toEqual([[["about"], ["home"]]]);
	// The output's own files only: the read kept the facts and the listing in memory.
	expect(readdirSync(join(dir, "out", ".grai")).sort()).not.toContain("facts");
	expect(readdirSync(join(dir, "out", ".grai")).sort()).not.toContain("files");
});

it("gives a start no groups when the code is not read by the time its compile is done, and stops", async () => {
	const { data, compiled } = freshApp();
	const weights = await compiled();
	const reading = firstGroups(data);

	expect(await reading.after(weights, 60_000)).toBeUndefined();
	await reading.stop();
	expect(await reading.read).toBe(false);
});

it("leaves nothing on disk once stopped, and the read once the server is quiet still groups the keys", async () => {
	const { dir, data, compiled } = freshApp();
	const reading = firstGroups(data);
	await reading.stop();

	expect(existsSync(join(dir, "out"))).toBe(false);
	const weights = await compiled();
	expect(await nextKeyGroups(readConfig(data.configFile), weights)).toEqual([
		["about"],
		["home"],
	]);
});

it("gives a start no groups when they do not come within the compile's time", async () => {
	const { data } = freshApp();
	const reading = firstGroups(
		data,
		script(
			`parentPort.postMessage("read");\nparentPort.on("message", () => {});`,
		),
	);
	onTestFinished(() => reading.stop());

	expect(await reading.read).toBe(true);
	expect(await reading.after(new Map(), 50)).toBeUndefined();
});

it("gives a start no groups, at once, when the read fails after reading the code", async () => {
	const { data } = freshApp();
	const reading = firstGroups(
		data,
		script(
			`parentPort.postMessage("read");\nparentPort.on("message", () => {\n\tthrow new Error("the read failed");\n});`,
		),
	);
	onTestFinished(() => reading.stop());

	expect(await reading.read).toBe(true);
	expect(await reading.after(new Map(), 600_000)).toBeUndefined();
});

it("settles a stop once the read's thread has stopped, though it never yields", async () => {
	const { data } = freshApp();
	const reading = firstGroups(
		data,
		script(`parentPort.postMessage("read");\nfor (;;) {}`),
	);

	expect(await reading.read).toBe(true);
	await reading.stop();
	expect(await reading.after(new Map(), 600_000)).toBeUndefined();
});
