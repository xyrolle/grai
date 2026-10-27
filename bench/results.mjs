// The results a bench records for the README's charts: results/<name>.json, beside what the bench
// prints, with when, where and with which versions it ran, so that scripts/charts.ts draws only
// what was measured, and rerunning the bench redraws it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, platform, release, totalmem } from "node:os";
import { join } from "node:path";

const directory = new URL("results/", import.meta.url).pathname;

/** The libraries the benches compare, as the bench's package installs them. */
const libraries = [
	"@inlang/paraglide-js",
	"i18next",
	"use-intl",
	"next-intl",
	"next",
	"vite",
	"rolldown",
	"playwright-core",
];

function versionOf(name) {
	const manifest = new URL(
		`node_modules/${name}/package.json`,
		import.meta.url,
	);
	return JSON.parse(readFileSync(manifest, "utf8")).version;
}

/** The commit that last changed grai's code, which the run measured, whatever branch it ran on. */
function commit() {
	return execFileSync("git", ["log", "-1", "--format=%h", "--", ":/src"], {
		cwd: new URL(".", import.meta.url),
		encoding: "utf8",
	}).trim();
}

/**
 * A fraction to a tenth, past which a time, a size or a load is the clock's noise; under ten, to
 * three significant digits, so that a ratio such as 1.07 keeps what tells it from 1.
 */
const rounded = (_, value) =>
	typeof value !== "number" || Number.isInteger(value)
		? value
		: Math.abs(value) < 10
			? Number(value.toPrecision(3))
			: Math.round(value * 10) / 10;

/** The one-minute load when a bench starts, which `recordResults` writes beside the end's. */
const loadAtStart = loadavg()[0];

/**
 * Writes a bench's results, `results/<name>.json`: `rows` as the bench measured them, and what
 * they were measured on. `extra` adds what only that bench knows, such as Chromium's version.
 */
export function recordResults(name, rows, extra = {}) {
	mkdirSync(directory, { recursive: true });
	const [cpu] = cpus();
	const recorded = {
		bench: name,
		date: new Date().toISOString(),
		machine: {
			cpu: cpu?.model ?? "unknown",
			cores: cpus().length,
			memoryGB: Math.round(totalmem() / 2 ** 30),
			os: `${platform()} ${release()}`,
		},
		load: { start: loadAtStart, end: loadavg()[0] },
		node: process.versions.node,
		grai: commit(),
		versions: Object.fromEntries(
			libraries.map((each) => [each, versionOf(each)]),
		),
		...extra,
		rows,
	};
	writeFileSync(
		join(directory, `${name}.json`),
		`${JSON.stringify(recorded, rounded, "\t")}\n`,
	);
}
