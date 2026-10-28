import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { readConfig } from "../src/config.ts";
import type { AppData } from "../src/next/app-data.ts";
import { firstGroups } from "../src/next/first-groups.ts";
import { startGroupRead } from "../src/next/group-read.ts";
import { nextKeyGroups } from "../src/next/key-groups.ts";
import { freshApp } from "./next-fresh-app.ts";

// The groups of a fresh app's keys read beside the first compile of its `next dev` start, on the
// thread withGrai starts (`group-read.ts`) and the watch hears on a port (`first-groups.ts`): what
// the read answers, before the output is written, and that stopping it leaves nothing behind.

/** A thread's script of the test's own, in a module file, removed after the test. */
function script(code: string): URL {
	const dir = mkdtempSync(join(tmpdir(), "grai-read-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "read.mjs");
	writeFileSync(
		file,
		`import { workerData } from "node:worker_threads";\nconst { port } = workerData;\n${code}\n`,
	);
	return pathToFileURL(file);
}

/** The read's thread on an app, or on a script of the test's own, and the watch's side of it. */
function reading(data: AppData, code?: string) {
	const thread = startGroupRead(
		data,
		code === undefined ? undefined : script(code),
	);
	onTestFinished(() => thread.stop());
	return { thread, read: firstGroups(thread.port) };
}

it("reads the code before the output is written, and the groups from each key's weight, writing nothing", async () => {
	const { dir, data, weights } = freshApp();
	const { read } = reading(data);

	expect(await read.read).toBe(true);
	expect(await read.after(await weights())).toEqual([["about"], ["home"]]);
	// The read kept the facts and the listing in memory: no file of the outdir is there.
	expect(existsSync(join(dir, "out"))).toBe(false);
});

it("gives no groups once stopped before the code is read", async () => {
	const { data, weights } = freshApp();
	const { thread, read } = reading(data);
	await thread.stop();

	expect(await read.read).toBe(false);
	expect(await read.after(await weights())).toBeUndefined();
});

it("leaves nothing on disk once stopped, and the read once the server is quiet still groups the keys", async () => {
	const { dir, data, compiled } = freshApp();
	const { thread } = reading(data);
	await thread.stop();

	expect(existsSync(join(dir, "out"))).toBe(false);
	const weights = await compiled();
	expect(await nextKeyGroups(readConfig(data.configFile), weights)).toEqual([
		["about"],
		["home"],
	]);
});

it("gives a start no groups, at once, when the read fails after reading the code", async () => {
	const { data } = freshApp();
	const { read } = reading(
		data,
		`port.postMessage("read");\nport.on("message", () => {\n\tthrow new Error("the read failed");\n});`,
	);

	expect(await read.read).toBe(true);
	expect(await read.after(new Map())).toBeUndefined();
});

it("settles a stop once the read's thread has stopped, though it never yields", async () => {
	const { data } = freshApp();
	const { thread, read } = reading(
		data,
		`port.postMessage("read");\nfor (;;) {}`,
	);

	expect(await read.read).toBe(true);
	await thread.stop();
	expect(await read.after(new Map())).toBeUndefined();
});
