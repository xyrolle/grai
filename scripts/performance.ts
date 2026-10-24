// A performance smoke check for CI: compiles a synthetic catalog of 20,001 messages (6,667 keys in
// three locales), then compiles it again unchanged, then edits one message at a time. It fails when
// a step takes more than twice its baseline, the median of CI's runs, so it catches a regression
// and not the noise of a shared runner.
//
// usage: node scripts/performance.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, recompile } from "../src/compile.ts";

const baselines = { cold: 180, noop: 8, edit: 6 };
const keys = 6667;
const edits = 15;

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
	for (let revision = 1; revision <= edits; revision++) {
		write(dir, "pl", revision);
		start = performance.now();
		const next = await recompile(config, build);
		times.push(performance.now() - start);
		build = next.build;
	}
	const edit = times.toSorted((a, b) => a - b)[Math.floor(edits / 2)] ?? 0;

	const steps: [string, number, number][] = [
		["cold", cold, baselines.cold],
		["noop", noop, baselines.noop],
		["edit", edit, baselines.edit],
	];
	let failed = false;
	for (const [step, measured, baseline] of steps) {
		const over = measured > 2 * baseline;
		failed ||= over;
		console.log(
			`${step.padEnd(5)} ${measured.toFixed(1).padStart(7)} ms   budget ${2 * baseline} ms${over ? "   over budget" : ""}`,
		);
	}
	if (failed) process.exitCode = 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
