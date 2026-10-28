// A performance smoke check for CI: compiles a synthetic catalog of 20,001 messages (6,667 keys in
// three locales), then compiles it again unchanged, then edits one message at a time, then runs the
// built CLI's compile from a fresh process on an empty outdir, then starts a Vite dev server with
// grai's plugin in a fresh process on an empty outdir. It fails when a step takes more than
// twice its baseline, the median of CI's runs, so it catches a regression and not the noise of a
// shared runner. Then it parses a pattern of escapes alone and one of placeholders alone, each at
// two sizes, and fails when the parser's time grows much faster than the pattern.
//
// usage: pnpm build && node scripts/performance.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, recompile } from "../src/compile.ts";
import { type Part, parsePattern } from "../src/pattern.ts";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
/** A script that times a process's first compile of the config it is given. */
const firstCompile = `
const { compile } = await import(${JSON.stringify(new URL("../src/compile.ts", import.meta.url).href)});
const started = performance.now();
await compile(process.argv[1]);
console.log(performance.now() - started);
`;
/**
 * A script that times a dev server's start in a process of its own, from the server's creation, once
 * Vite and the plugin have loaded, until it has keys.js, every message, for a page to load: the first
 * compile, and the module the server makes of it. Its root is the project's directory.
 */
const devStart = `
const { createServer } = await import(${JSON.stringify(import.meta.resolve("vite"))});
const { grai } = await import(${JSON.stringify(new URL("../src/vite.ts", import.meta.url).href)});
const started = performance.now();
const server = await createServer({
	root: process.argv[1],
	configFile: false,
	logLevel: "silent",
	server: { middlewareMode: true, watch: null },
	plugins: [grai()],
});
await server.environments.client.transformRequest("/out/keys.js");
console.log(performance.now() - started);
await server.close();
`;

/**
 * Each step's median time over ten runs on CI's runners, rounded up; the budget is twice it. The
 * runners differ by up to half: a first compile in a fresh process took 145 to 249 ms, a no-op 1.5 to
 * 2.5 ms, an edit 3.7 to 6.1 ms and the CLI 177 to 273 ms. The dev server's start has no runs on CI
 * yet: its baseline is its median on an M5 Pro, 119 ms, times the ratio of CI's first compile to
 * that machine's, 200 to 81 ms.
 */
const baselines = { cold: 200, noop: 2, edit: 4, process: 240, dev: 300 };
const keys = 6667;
/** Runs made before the timed ones of a step, while the engine still optimizes it. */
const warmupRuns = 10;
/**
 * How many times each step after the first compile is timed. Its median is the step's time, which
 * one slow run on a busy runner cannot move.
 */
const timedEdits = 31;
const timedNoops = 31;
const timedProcesses = 3;
const timedDevStarts = 3;
/** A first compile is timed in fresh processes, each compile then the first in its process. */
const timedColds = 3;

/** The median of `runs` times `step` gives, after `warmups` it is run untimed. */
async function median(
	runs: number,
	step: () => Promise<number>,
	warmups = 0,
): Promise<number> {
	const times: number[] = [];
	for (let run = 0; run < warmups + runs; run++) {
		const time = await step();
		if (run >= warmups) times.push(time);
	}
	return times.toSorted((a, b) => a - b)[Math.floor(runs / 2)] ?? 0;
}

/** How long `work` takes, in milliseconds. */
async function timed(work: () => unknown): Promise<number> {
	const started = performance.now();
	await work();
	return performance.now() - started;
}

function catalog(locale: string, revision = 0): Record<string, unknown> {
	const categories =
		locale === "pl" ? ["one", "few", "many", "other"] : ["one", "other"];
	const messages: Record<string, unknown> = {};
	for (let index = 0; index < keys; index++) {
		const key = `section${index % 40}_message${index}`;
		const words = `${locale} words of message ${index}, revision ${index === 0 ? revision : 0}`;
		if (index % 20 === 0) {
			messages[key] = [
				{
					declarations: ["input count", "local countPlural = count: plural"],
					selectors: ["countPlural"],
					match: Object.fromEntries(
						categories.map((category) => [
							`countPlural=${category}`,
							`{count} ${category} ${words}`,
						]),
					),
				},
			];
		} else if (index % 10 === 1) {
			messages[key] = `${words} for {name}`;
		} else if (index % 50 === 2) {
			messages[key] = `${words} with {#link}a link{/link}`;
		} else {
			messages[key] = words;
		}
	}
	return messages;
}

const write = (dir: string, locale: string, revision?: number) =>
	writeFileSync(
		join(dir, "messages", `${locale}.json`),
		JSON.stringify(catalog(locale, revision), null, "\t"),
	);

const dir = mkdtempSync(join(tmpdir(), "grai-performance-"));
try {
	mkdirSync(join(dir, "messages"));
	for (const locale of ["en", "de", "pl"]) write(dir, locale);
	const config = join(dir, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: ["en", "de", "pl"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);

	const cold = await median(timedColds, async () => {
		rmSync(join(dir, "out"), { recursive: true, force: true });
		return Number(
			execFileSync(
				process.execPath,
				["--input-type=module", "-e", firstCompile, config],
				{
					encoding: "utf8",
				},
			),
		);
	});
	await compile(config);
	const noop = await median(
		timedNoops,
		() => timed(() => compile(config)),
		warmupRuns,
	);
	let { build } = await recompile(config, undefined);
	let revision = 0;
	const edit = await median(
		timedEdits,
		() => {
			write(dir, "pl", ++revision);
			return timed(async () => {
				build = (await recompile(config, build)).build;
			});
		},
		warmupRuns,
	);
	const fresh = await median(timedProcesses, () => {
		rmSync(join(dir, "out"), { recursive: true, force: true });
		return timed(() =>
			execFileSync(process.execPath, [cli, "compile", "--config", config]),
		);
	});

	const dev = await median(timedDevStarts, async () => {
		rmSync(join(dir, "out"), { recursive: true, force: true });
		return Number(
			execFileSync(
				process.execPath,
				["--input-type=module", "-e", devStart, dir],
				{ encoding: "utf8" },
			),
		);
	});

	const steps: [string, number, number][] = [
		["cold", cold, baselines.cold],
		["noop", noop, baselines.noop],
		["edit", edit, baselines.edit],
		["process", fresh, baselines.process],
		["dev", dev, baselines.dev],
	];
	let failed = false;
	for (const [step, measured, baseline] of steps) {
		const over = measured > 2 * baseline;
		failed ||= over;
		console.log(
			`${step.padEnd(7)} ${measured.toFixed(1).padStart(7)} ms   budget ${2 * baseline} ms${over ? "   over budget" : ""}`,
		);
	}
	failed ||= !patternParsesLinearly();
	if (failed) process.exitCode = 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}

/**
 * Whether the pattern parser's time grows about as its pattern does: on a pattern of escapes alone
 * and one of placeholders alone, each at two sizes eight times apart, each must parse to what it
 * holds, and its time grow at most four times the sizes' ratio, 32 times. A parser that searched the
 * rest of the pattern again at each escape or placeholder grew with the square, 64 times.
 */
function patternParsesLinearly(): boolean {
	const sizes = [1 << 16, 1 << 19] as const;
	const shapes: [
		string,
		(count: number) => string,
		(count: number) => Part[],
	][] = [
		[
			"escapes",
			(count) => "\\\\".repeat(count),
			(count) => [{ type: "text", value: "\\".repeat(count) }],
		],
		[
			"placeholders",
			(count) => "{x}".repeat(count),
			(count) =>
				Array.from({ length: count }, () => ({ type: "variable", name: "x" })),
		],
	];
	let linear = true;
	for (const [shape, pattern, parts] of shapes) {
		const times = sizes.map((count) => {
			const source = pattern(count);
			let fastest = Number.POSITIVE_INFINITY;
			for (let run = 0; run < 5; run++) {
				const started = performance.now();
				const parsed = parsePattern(source);
				fastest = Math.min(fastest, performance.now() - started);
				if (JSON.stringify(parsed) !== JSON.stringify(parts(count))) {
					throw new Error(
						`a pattern of ${count} ${shape} parsed to other parts`,
					);
				}
			}
			return fastest;
		});
		const [small = 0, large = 0] = times;
		const growth = large / small;
		const over = growth > 32;
		linear &&= !over;
		console.log(
			`parse   ${shape.padEnd(12)} ${small.toFixed(1)} → ${large.toFixed(1)} ms, ${growth.toFixed(1)} times for 8 times the size   budget 32 times${over ? "   over budget" : ""}`,
		);
	}
	return linear;
}
