// The refactoring commands on a whole app: check, find, rename and check --fix, each in a new
// Node process, timed once grai's modules have loaded. They run on a project in the system's
// temporary directory, removed after (refactor-project.mjs): a copy of app A or B, or a synthetic
// project of app B's size that anyone can run. The output is compiled first, as a project's is, since the commands
// follow imports to it. find and rename take the key the most files name; check --fix removes 50
// unused keys added to each catalog, then checks, as the command does: it runs the command itself,
// its output kept from the terminal. Each command is timed cold, without the facts kept on disk,
// and warm, with them: medians of three runs.
//   node refactor.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graiModule } from "./grai.mjs";
import {
	busiestKey,
	snapshot,
	writeRefactorProject,
} from "./refactor-project.mjs";
import { recordResults } from "./results.mjs";

const RUNS = 3;
const UNUSED = 50;
const self = new URL(import.meta.url).pathname;
const commands = {
	compile: ["compile.ts", "compile"],
	check: ["check.ts", "check"],
	find: ["find.ts", "find"],
	rename: ["rename.ts", "rename"],
	fix: ["cli/check.ts", "checkCommand"],
};

/**
 * Runs in the child: one command, timed after its module loads, printed as milliseconds on the
 * last line. `check --fix` is the command's own run, which prints what it removed and checked, and
 * its exit code, the check's verdict, is on that line too.
 */
async function child(command, config, ...args) {
	const [file, name] = commands[command];
	const exported = (await import(graiModule(file)))[name];
	const start = performance.now();
	if (command === "fix") {
		const code = await exported.run(["--fix", "--config", config]);
		console.log(JSON.stringify({ ms: performance.now() - start, code }));
		return;
	}
	const result = await exported(config, ...args);
	const ms = performance.now() - start;
	if (command === "compile") {
		if (result.errors.length > 0) throw result.errors[0];
		return;
	}
	const errors = Array.isArray(result) ? result : result.errors;
	// rename refuses a key a read by a computed name may reach, and that is its answer, not a failure.
	if (command === "rename" && errors.length > 0) {
		console.log(JSON.stringify({ ms, refused: true }));
		return;
	}
	if (command !== "check" && errors.length > 0) throw errors[0];
	console.log(JSON.stringify({ ms }));
}

/**
 * The median of the runs, each after its own setup and then its check of the run's result, in
 * milliseconds, or "refused" when the command refused a run.
 */
function median(setup, args, after = () => {}) {
	const runs = Array.from({ length: RUNS }, (_, run) => {
		setup(run);
		const output = execFileSync(
			process.execPath,
			[self, "--child", ...args(run)],
			{
				encoding: "utf8",
			},
		);
		const result = JSON.parse(output.trim().split("\n").at(-1) ?? "");
		after(result);
		return result;
	});
	if (runs.some((run) => run.refused)) return "refused";
	const ms = runs.map((run) => run.ms).toSorted((a, b) => a - b);
	return ms[Math.floor(RUNS / 2)] ?? 0;
}

/** Adds unused keys at the top of each catalog, as text, so every other byte stays. */
function addUnusedKeys(dir, catalogs, locales) {
	for (const locale of locales) {
		const path = join(dir, catalogs.replace("{locale}", locale));
		const text = readFileSync(path, "utf8");
		const start = text.indexOf("\n") + 1;
		const unused = Array.from(
			{ length: UNUSED },
			(_, n) => `\t"zz_unused_${n}": "unused",\n`,
		);
		writeFileSync(
			path,
			text.slice(0, start) + unused.join("") + text.slice(start),
		);
	}
}

/**
 * Throws unless check --fix took the unused keys out of every catalog and then checked, which
 * gives its verdict as the exit code. Whether the check found problems the bench does not judge.
 */
function fixedAndChecked(dir, catalogs, locales, { code }) {
	if (code !== 0 && code !== 1)
		throw new Error(
			"check --fix timed the removal alone: no check followed it",
		);
	for (const locale of locales) {
		const path = join(dir, catalogs.replace("{locale}", locale));
		if (readFileSync(path, "utf8").includes('"zz_unused_'))
			throw new Error(`check --fix left unused keys in ${path}`);
	}
}

if (process.argv[2] === "--child") {
	await child(...process.argv.slice(3));
} else {
	for (const app of process.argv.length > 2
		? process.argv.slice(2)
		: ["synthetic"]) {
		const dir = mkdtempSync(join(tmpdir(), `grai-refactor-${app}-`));
		try {
			const project = writeRefactorProject(app, dir);
			const { locales, catalogs, outdir } = project;
			const config = join(dir, "grai.config.json");
			execFileSync(process.execPath, [self, "--child", "compile", config]);
			const facts = join(dir, outdir, ".grai", "facts");
			const cold = () => rmSync(facts, { force: true });
			const key = busiestKey(
				snapshot(dir, project),
				locales.map((locale) => catalogs.replace("{locale}", locale)),
			);
			const none = () => {};
			// The runs rename the key and back, so each renames the same call sites: counted across the
			// cold runs and the warm ones, as an odd number of runs leaves the key renamed.
			let renames = 0;
			const names = () =>
				renames++ % 2 === 0 ? [key, `${key}_x`] : [`${key}_x`, key];
			const timed = (setup, args, after) => {
				const coldly = median(
					(run) => {
						cold();
						setup(run);
					},
					args,
					after,
				);
				return { cold: coldly, warm: median(setup, args, after) };
			};
			const ms = {
				check: timed(none, () => ["check", config]),
				find: timed(none, () => ["find", config, key]),
				rename: timed(none, () => ["rename", config, ...names()]),
				"check --fix": timed(
					() => addUnusedKeys(dir, catalogs, locales),
					() => ["fix", config],
					(result) => fixedAndChecked(dir, catalogs, locales, result),
				),
			};
			const shown = (value) =>
				typeof value === "number" ? `${value.toFixed(0)} ms` : value;
			const times = Object.entries(ms).map(
				([name, { cold, warm }]) =>
					`${name} ${shown(cold)} (warm ${shown(warm)})`,
			);
			console.log(`${app}: ${times.join(", ")}`);
			recordResults(`refactor-${app}`, ms, { runs: RUNS });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
