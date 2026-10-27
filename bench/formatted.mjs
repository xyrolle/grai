// A catalog that formats in every message: 13,000 keys in ro, ru and en, every other one a
// currency and the rest a date, each run in a new Node process, from this repository's build.
// It times a compile from an empty output, `check`, an XLIFF export of ru, one edited message
// recompiled as the watcher does, and a recompile with nothing changed. Medians.
//   node formatted.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./apps.mjs";
import { graiModule } from "./grai.mjs";

const KEYS = 13_000;
const self = new URL(import.meta.url).pathname;
const formats = [
	"{amount :currency currency=EUR}",
	"{when :datetime dateStyle=long timeZone=UTC}",
];

/** Writes the project and returns its config file. */
function writeProject() {
	const directory = join(cacheDir, "formatted");
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(join(directory, "messages"), { recursive: true });
	for (const locale of ["ro", "ru", "en"]) {
		const messages = Object.fromEntries(
			Array.from({ length: KEYS }, (_, index) => [
				`message${index}`,
				`${locale} label ${index} ${formats[index % 2]}`,
			]),
		);
		writeFileSync(
			join(directory, "messages", `${locale}.json`),
			`${JSON.stringify(messages, null, "\t")}\n`,
		);
	}
	// A source that calls every key, so `check` finds each one used, as in an app.
	mkdirSync(join(directory, "src"));
	writeFileSync(
		join(directory, "src", "calls.js"),
		Array.from({ length: KEYS }, (_, index) => `m.message${index}();`).join(
			"\n",
		),
	);
	const config = join(directory, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: ["ro", "ru", "en"],
			baseLocale: "ro",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	return config;
}

const median = (values) =>
	values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

/** Times `run` `count` times, after `prepare`, failing on any error it reports. */
async function timed(count, run, prepare = () => {}) {
	const times = [];
	for (let index = 0; index < count; index++) {
		prepare(index);
		const start = performance.now();
		const result = await run();
		times.push(performance.now() - start);
		const errors = result.errors ?? result.result?.errors ?? result.problems;
		if (errors?.length > 0) throw new Error(errors[0].message);
	}
	return median(times);
}

/** Runs in the child: one measure, as JSON. */
async function child(measure, config) {
	const out = join(config, "..", "out");
	const ru = join(config, "..", "messages", "ru.json");
	const { compile, recompile } = await import(graiModule("compile.ts"));
	if (measure === "cold") {
		const ms = await timed(
			5,
			() => compile(config),
			() => rmSync(out, { recursive: true, force: true }),
		);
		return console.log(JSON.stringify({ ms }));
	}
	if (measure === "check") {
		const { check } = await import(graiModule("check.ts"));
		return console.log(
			JSON.stringify({ ms: await timed(3, () => check(config)) }),
		);
	}
	if (measure === "export") {
		const { exportLocale } = await import(graiModule("translations.ts"));
		const ms = await timed(3, () =>
			exportLocale(config, "ru", { json: false, untranslated: false }),
		);
		return console.log(JSON.stringify({ ms }));
	}
	let { build } = await recompile(config, undefined);
	const original = readFileSync(ru, "utf8");
	const recompiled = async () => {
		const next = await recompile(config, build);
		build = next.build;
		return next;
	};
	const ms =
		measure === "edit"
			? await timed(15, recompiled, (index) =>
					writeFileSync(
						ru,
						original.replace(
							"ru label 10000",
							`edited ${index} ru label 10000`,
						),
					),
				)
			: await timed(15, recompiled);
	writeFileSync(ru, original);
	console.log(JSON.stringify({ ms }));
}

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4]);
} else {
	const config = writeProject();
	const measures = [
		["cold", "compile, empty output"],
		["check", "`check`"],
		["export", "XLIFF export of ru"],
		["edit", "one message edited, recompiled"],
		["noop", "recompile, nothing changed"],
	];
	console.log("| 13,000 formatted keys × 3 | median |");
	console.log("| --- | --- |");
	for (const [measure, label] of measures) {
		const { ms } = JSON.parse(
			execFileSync(process.execPath, [self, "--child", measure, config], {
				encoding: "utf8",
			})
				.trim()
				.split("\n")
				.at(-1),
		);
		console.log(`| ${label} | ${ms.toFixed(1)} ms |`);
	}
}
