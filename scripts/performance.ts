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

/** The median of three runs on CI's runner, rounded up: an edit took 4.8, 3.6 and 4.0 ms. */
const baselines = { cold: 110, noop: 3, edit: 4, process: 160 };
const keys = 6667;
/** Edits made before the timed ones, while the engine still optimizes the recompile. */
const warmupEdits = 10;
/** Edits timed; their median is the step's time, which one slow edit on a busy runner cannot move. */
const timedEdits = 31;

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

	let start = performance.now();
	await compile(config);
	const cold = performance.now() - start;
	start = performance.now();
	await compile(config);
	const noop = performance.now() - start;
	let { build } = await recompile(config, undefined);
	const times: number[] = [];
	for (let revision = 1; revision <= warmupEdits + timedEdits; revision++) {
		write(dir, "pl", revision);
		start = performance.now();
		const next = await recompile(config, build);
		if (revision > warmupEdits) times.push(performance.now() - start);
		build = next.build;
	}
	const edit = times.toSorted((a, b) => a - b)[Math.floor(timedEdits / 2)] ?? 0;

	rmSync(join(dir, "out"), { recursive: true });
	start = performance.now();
	execFileSync(process.execPath, [cli, "compile", "--config", config]);
	const fresh = performance.now() - start;

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
