// Typed keys: what type checking a file of 500 message calls costs with each library's typed
// keys: grai's and Paraglide's generated declarations, i18next's keys merged into its types from
// the locale's JSON (`CustomTypeOptions`), and use-intl's, inferred from the messages it is
// given. `tsc --noEmit` with TypeScript 7, and the editor's completions after `m.` or inside `t("`
// (completions.mjs), from TypeScript 6's language service, which tsserver runs, and from
// TypeScript 7's language server: the first request, which checks what it needs of the program;
// the next one, the file unchanged; the details of the list's first entry, asked apart; and one
// after each edit an editor's user makes: a typed prefix, a new call site, and a key added to the
// catalog. Each sample is a new process, its project's catalog written as the app has it; every
// library takes one each round, in an order that rotates, so the load from other work weighs on
// each alike. Medians of ROUNDS, with every sample kept: 9 by default, the fewest whose interval
// leaves out the lowest and the highest sample and still holds the median with 95% confidence
// (medians.mjs).
//   node types.mjs [app...]      ROUNDS=<n> to change the rounds
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { writeState } from "./completions.mjs";
import { recordResults } from "./results.mjs";
import { CALLS, writeProjects } from "./types-projects.mjs";

const ROUNDS = Number(process.env.ROUNDS ?? 9);
if (!Number.isInteger(ROUNDS) || ROUNDS < 1)
	throw new Error(`ROUNDS is ${process.env.ROUNDS}: a whole number of rounds.`);
/** Past this, a sample is stuck: i18next's first completion takes about six minutes. */
const SAMPLE_DEADLINE_MS = 60 * 60 * 1000;
const here = new URL(".", import.meta.url).pathname;
const tsc7 = join(here, "node_modules/.bin/tsc");

/** The language servers a completion sample runs on, by the script that drives each. */
const engines = {
	ts6: "completion-ts6.mjs",
	ts7: "completion-ts7.mjs",
};

/** The requests of a completion sample, as the tables head them. */
const steps = {
	first: "first completion",
	next: "next completion, unchanged",
	details: "the first entry's details",
	prefix: "after a typed prefix",
	callSite: "at a new call site",
	catalog: "after a catalog change",
};

/** Milliseconds `tsc --noEmit` takes on the project, its process included. */
function typeCheck(project) {
	const start = performance.now();
	execFileSync(tsc7, ["-p", project.directory], { stdio: "inherit" });
	return performance.now() - start;
}

/**
 * One completion sample in a new process, the project's catalog first written as the app has it:
 * each request's milliseconds, and TypeScript's version.
 */
function completions(project, engine) {
	writeState(project, "before");
	const output = execFileSync(
		process.execPath,
		[join(here, engines[engine]), project.description],
		{ encoding: "utf8", timeout: SAMPLE_DEADLINE_MS },
	);
	return JSON.parse(output.trim().split("\n").at(-1));
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** A cell of a table: the median and the range of the samples. */
const cell = (values) =>
	`${median(values).toFixed(0)} (${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)})`;

/** Each step's samples, empty. */
const noSamples = () =>
	Object.fromEntries(Object.keys(steps).map((step) => [step, []]));

/** Each step's median. */
const medians = (taken) =>
	Object.fromEntries(
		Object.entries(taken).map(([step, values]) => [step, median(values)]),
	);

for (const app of selectedApps()) {
	const projects = await writeProjects(app);
	const samples = new Map(
		projects.map((project) => [
			project,
			{ tsc: [], ts6: noSamples(), ts7: noSamples() },
		]),
	);
	const versions = { ts6: "", ts7: "" };
	for (let round = 0; round < ROUNDS; round++) {
		for (let index = 0; index < projects.length; index++) {
			const project = projects[(index + round) % projects.length];
			const taken = samples.get(project);
			writeState(project, "before");
			taken.tsc.push(typeCheck(project));
			for (const engine of Object.keys(engines)) {
				const sample = completions(project, engine);
				for (const step of Object.keys(steps))
					taken[engine][step].push(sample[step]);
				versions[engine] = sample.typescript;
			}
		}
	}
	console.log(
		`\n### ${app.name}: ${CALLS} message calls, ms, medians of ${ROUNDS} (range)\n`,
	);
	console.log(
		`| keys typed by | \`tsc --noEmit\`, TypeScript ${versions.ts7} |\n|---|---|`,
	);
	for (const project of projects)
		console.log(`| ${project.title} | ${cell(samples.get(project).tsc)} |`);
	for (const [engine, server] of [
		["ts6", `TypeScript ${versions.ts6}'s language service`],
		["ts7", `TypeScript ${versions.ts7}'s language server`],
	]) {
		console.log(`\nCompletions, ${server}:\n`);
		console.log(`| keys typed by | ${Object.values(steps).join(" | ")} |`);
		console.log(`|---|${"---|".repeat(Object.keys(steps).length)}`);
		for (const project of projects) {
			const taken = samples.get(project)[engine];
			const cells = Object.keys(steps).map((step) => cell(taken[step]));
			console.log(`| ${project.title} | ${cells.join(" | ")} |`);
		}
	}
	const rows = projects.map((project) => {
		const { tsc, ts6, ts7 } = samples.get(project);
		return {
			library: project.title,
			tsc: median(tsc),
			...medians(ts6),
			ts7: medians(ts7),
			samples: { tsc, ts6, ts7 },
		};
	});
	recordResults(`types-${app.id}`, rows, {
		app: app.name,
		calls: CALLS,
		runs: ROUNDS,
		typescript: {
			tsc: versions.ts7,
			languageService: versions.ts6,
			languageServer: versions.ts7,
		},
	});
}
