import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished, vi } from "vitest";
import { project } from "./project.ts";
import { messagesOf } from "./reader.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

/**
 * A test's budget when it starts processes: on a loaded machine each new one takes a second or more
 * to load grai, so a test of several outlasts Vitest's 5 s.
 */
const processTest = { timeout: 60_000 };

const lockModule = fileURLToPath(
	new URL("../src/output-lock.ts", import.meta.url),
);

/** Runs `script` in a process of its own, with `lockOutput` and the arguments it is given. */
function processRunning(script: string, ...args: string[]): ChildProcess {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`const { lockOutput } = await import(process.argv[1]);\n${script}`,
			lockModule,
			...args,
		],
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	onTestFinished(() => {
		child.kill("SIGKILL");
	});
	return child;
}

/** A process that takes an outdir's lock and holds it, until it is told to let go or killed. */
async function lockHolder(state: string): Promise<ChildProcess> {
	const holder = processRunning(
		`const release = await lockOutput(process.argv[2]);
console.log("held");
process.stdin.once("data", async () => { await release(); process.exit(0); });`,
		state,
	);
	const lines = createInterface({ input: holder.stdout ?? process.stdin });
	await once(lines, "line");
	return holder;
}

async function killed(child: ChildProcess): Promise<void> {
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
}

it(
	"takes over the lock of a writer killed while it held it",
	processTest,
	async () => {
		const { dir, compile } = project(catalogs);
		await killed(await lockHolder(join(dir, "out", ".grai")));

		expect((await compile()).errors).toEqual([]);
		expect((await messagesOf(dir)).title?.()).toBe("Title");
	},
);

it(
	"lets the processes that find a dead writer's lock take it over one at a time",
	processTest,
	async () => {
		for (let trial = 0; trial < 3; trial++) {
			const { dir } = project(catalogs);
			const state = join(dir, "out", ".grai");
			await killed(await lockHolder(state));
			const log = join(dir, "writers.log");

			const writers = [1, 2, 3, 4].map(() =>
				processRunning(
					`const { appendFileSync } = await import("node:fs");
const release = await lockOutput(process.argv[2]);
appendFileSync(process.argv[3], "in " + process.pid + "\\n");
await new Promise((resolve) => setTimeout(resolve, 30));
appendFileSync(process.argv[3], "out " + process.pid + "\\n");
await release();`,
					state,
					log,
				),
			);
			const codes = await Promise.all(
				writers.map(async (writer) => (await once(writer, "exit"))[0]),
			);

			expect(codes).toEqual([0, 0, 0, 0]);
			const lines = readFileSync(log, "utf8").trim().split("\n");
			expect(lines).toHaveLength(8);
			for (let index = 0; index < lines.length; index += 2) {
				const pid = lines[index]?.slice("in ".length);
				expect([lines[index], lines[index + 1]]).toEqual([
					`in ${pid}`,
					`out ${pid}`,
				]);
			}
		}
	},
);

it(
	"waits for a live writer's lock, and writes once it lets go",
	processTest,
	async () => {
		const { dir, compile } = project(catalogs);
		const state = join(dir, "out", ".grai");
		const holder = await lockHolder(state);

		const compiling = compile();
		// This process's claim beside the lock says its compile is at the lock.
		await vi.waitFor(() =>
			expect(
				readdirSync(state).some((name) =>
					name.startsWith(`lock.${process.pid}.`),
				),
			).toBe(true),
		);
		const writtenBefore = existsSync(join(dir, "out", "keys.js"));
		const released = once(holder, "exit");
		holder.stdin?.write("go\n");
		await released;

		expect(writtenBefore).toBe(false);
		expect((await compiling).errors).toEqual([]);
		expect((await messagesOf(dir)).title?.()).toBe("Title");
	},
);

it(
	"gives up on a takeover whose writer stays alive without ending it, after the wait a live lock gets, naming the takeover",
	processTest,
	async () => {
		const { dir, compile } = project(catalogs);
		const state = join(dir, "out", ".grai");
		mkdirSync(state, { recursive: true });
		const gone = spawnSync(process.execPath, ["-e", ""]).pid;
		writeFileSync(join(state, "lock"), `${gone} gone-writer`);
		// A writer that took over the dead one's lock and stopped there, alive, as one paused by
		// SIGSTOP or at a debugger's breakpoint would.
		const remover = processRunning("setInterval(() => {}, 60_000);");
		const takeover = join(state, "lock.taking.gone-writer");
		writeFileSync(takeover, `${remover.pid} remover`);
		// The wait is 30 s: the clock moves past it once the compile waits, with no test-only setting.
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const compiling = compile();
		await vi.waitFor(() =>
			expect(
				readdirSync(state).some((name) =>
					name.startsWith(`lock.${process.pid}.`),
				),
			).toBe(true),
		);
		vi.setSystemTime(Date.now() + 31_000);
		const { errors } = await compiling;

		expect(errors.map(({ code }) => code)).toEqual(["output-locked"]);
		expect(errors[0]?.message).toContain(`process ${remover.pid}`);
		expect(errors[0]?.message).toContain(`delete ${takeover}`);
		expect(existsSync(join(dir, "out", "keys.js"))).toBe(false);
	},
);
