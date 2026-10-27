// Typed keys: what type checking a file of 500 message calls costs with each library's typed
// keys: grai's and Paraglide's generated declarations, i18next's keys merged into its types from
// the locale's JSON (`CustomTypeOptions`), and use-intl's, inferred from the messages it is
// given. `tsc --noEmit` with TypeScript 7, and the editor's completions after `m.` or inside `t("`
// (completions.mjs), from TypeScript 6's language service, which tsserver runs: the first request,
// which checks what it needs of the program, and the next one, the file unchanged. Each sample is
// a new process; every library takes one each round, in an order that rotates, so the load from
// other work weighs on each alike. Medians of ROUNDS, with every sample kept.
//   node types.mjs [app...]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { recordResults } from "./results.mjs";
import { CALLS, writeProjects } from "./types-projects.mjs";

const ROUNDS = 3;
/** Past this, a sample is stuck: i18next's first completion takes about six minutes. */
const SAMPLE_DEADLINE_MS = 60 * 60 * 1000;
const here = new URL(".", import.meta.url).pathname;
const tsc7 = join(here, "node_modules/.bin/tsc");

/** TypeScript 7's version, as its tsc prints it. */
const ts7Version = () =>
	execFileSync(tsc7, ["--version"], { encoding: "utf8" })
		.trim()
		.split(" ")
		.at(-1);

/** Milliseconds `tsc --noEmit` takes on the project, its process included. */
function typeCheck(project) {
	const start = performance.now();
	execFileSync(tsc7, ["-p", project.directory], { stdio: "inherit" });
	return performance.now() - start;
}

/** One completion sample in a new process: each request's milliseconds, and TypeScript's version. */
function completions(project) {
	const output = execFileSync(
		process.execPath,
		[join(here, "completion-ts6.mjs"), project.description],
		{ encoding: "utf8", timeout: SAMPLE_DEADLINE_MS },
	);
	return JSON.parse(output.trim().split("\n").at(-1));
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** A cell of the table: the median and the range of the samples. */
const cell = (values) =>
	`${median(values).toFixed(0)} (${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)})`;

for (const app of selectedApps()) {
	const projects = await writeProjects(app);
	const samples = new Map(
		projects.map((project) => [
			project,
			{ tsc: [], first: [], next: [], typescript: undefined },
		]),
	);
	for (let round = 0; round < ROUNDS; round++) {
		for (let index = 0; index < projects.length; index++) {
			const project = projects[(index + round) % projects.length];
			const taken = samples.get(project);
			taken.tsc.push(typeCheck(project));
			const { typescript, first, next } = completions(project);
			taken.first.push(first);
			taken.next.push(next);
			taken.typescript = typescript;
		}
	}
	console.log(
		`\n### ${app.name}: type checking ${CALLS} message calls, ms, medians of ${ROUNDS} (range)\n`,
	);
	console.log(
		"| keys typed by | `tsc --noEmit`, TypeScript 7 | first completion, TypeScript 6 | next completion, unchanged |",
	);
	console.log("|---|---|---|---|");
	const rows = projects.map((project) => {
		const { tsc, first, next } = samples.get(project);
		console.log(
			`| ${project.title} | ${cell(tsc)} | ${cell(first)} | ${cell(next)} |`,
		);
		return {
			library: project.title,
			tsc: median(tsc),
			first: median(first),
			next: median(next),
			samples: { tsc, first, next },
		};
	});
	recordResults(`types-${app.id}`, rows, {
		app: app.name,
		calls: CALLS,
		runs: ROUNDS,
		typescript: {
			tsc: ts7Version(),
			languageService: samples.get(projects[0]).typescript,
		},
	});
}
