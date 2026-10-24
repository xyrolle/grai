// A performance smoke check for CI: compiles a synthetic catalog of 20,001 messages (6,667 keys in
// three locales), then compiles it again unchanged, then edits one message at a time, then runs the
// built CLI's compile from a fresh process on an empty outdir. It fails when a step takes more than
// twice its baseline, the median of CI's runs, so it catches a regression and not the noise of a
// shared runner.
//
// usage: pnpm build && node scripts/performance.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, recompile } from "../src/compile.ts";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
/** A script that times a process's first compile of the config it is given. */
const firstCompile = `
const { compile } = await import(${JSON.stringify(new URL("../src/compile.ts", import.meta.url).href)});
const started = performance.now();
await compile(process.argv[1]);
console.log(performance.now() - started);
`;

/** The median of three runs on CI's runner, rounded up: an edit took 4.8, 3.6 and 4.0 ms. */
const baselines = { cold: 110, noop: 3, edit: 4, process: 160 };
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

	const steps: [string, number, number][] = [
		["cold", cold, baselines.cold],
		["noop", noop, baselines.noop],
		["edit", edit, baselines.edit],
		["process", fresh, baselines.process],
	];
	let failed = false;
	for (const [step, measured, baseline] of steps) {
		const over = measured > 2 * baseline;
		failed ||= over;
		console.log(
			`${step.padEnd(7)} ${measured.toFixed(1).padStart(7)} ms   budget ${2 * baseline} ms${over ? "   over budget" : ""}`,
		);
	}
	if (failed) process.exitCode = 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
