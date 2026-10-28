// The refactoring commands on a whole project (refactor-project.mjs), each through grai's CLI as a
// user runs it, a new Node process timed from its launch until it exits: `check --json`, `find`
// and `rename` on the key the most source files name, and `check --fix` after UNUSED keys no code
// names are added at the top of each catalog. The output is compiled first, as a project's is,
// since the commands follow imports to it. Each command runs cold and warm, the two interleaved in
// rounds whose order rotates (rounds.mjs), every sample kept with its round's load. Cold keeps
// nothing grai keeps between commands: the facts and the file listing in the outdir's .grai are
// removed. The compiled output stays, and so do the file system's caches of the project's files.
// Warm has the state the run before it left. Every run starts from the same project: a file the
// run before changed is written back as it was, and the output compiled again. A run that fails
// fails the bench: check and check --fix may exit 1, which is their verdict.
//   node refactor.mjs [app...]      synthetic by default; a or b with GRAI_BENCH_A or _B
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { graiCli } from "./grai.mjs";
import { median, medianInterval } from "./medians.mjs";
import {
	busiestKey,
	snapshot,
	writeRefactorProject,
} from "./refactor-project.mjs";
import { recordResults } from "./results.mjs";
import { inRounds, roundCount, roundsRecord } from "./rounds.mjs";

const UNUSED = 50;
const unused = Array.from({ length: UNUSED }, (_, n) => `zz_unused_${n}`);
const modes = ["cold", "warm"];
const CLOCK =
	"grai's CLI in a new Node process, from its launch until it exits";
const COLD =
	"the facts and the file listing grai keeps in the outdir's .grai removed; the compiled output and the file system's caches kept";

/** One run of grai's CLI in the project, timed from the process's launch until it exits. */
function cli(dir, args) {
	const start = performance.now();
	const run = spawnSync(
		process.execPath,
		[graiCli, ...args, "--config", join(dir, "grai.config.json")],
		{ cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 },
	);
	const ms = performance.now() - start;
	if (run.error !== undefined) throw run.error;
	return { ms, status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Adds the unused keys at the top of each catalog, as text, so every other byte stays. */
function addUnusedKeys(dir, catalogs) {
	for (const catalog of catalogs) {
		const path = join(dir, catalog);
		const text = readFileSync(path, "utf8");
		const start = text.indexOf("\n") + 1;
		const added = unused.map((key) => `\t"${key}": "unused",\n`).join("");
		writeFileSync(path, text.slice(0, start) + added + text.slice(start));
	}
}

/** Throws unless the run exited with one of `statuses`. */
function assertExited(run, statuses) {
	if (!statuses.includes(run.status))
		throw new Error(`grai exited ${run.status}:\n${run.stderr}`);
}

/** The project and how each command runs on it. */
function prepareProject(app, dir) {
	const project = writeRefactorProject(app, dir);
	const files = snapshot(dir, project);
	const catalogs = project.locales.map((locale) =>
		project.catalogs.replace("{locale}", locale),
	);
	const compiled = cli(dir, ["compile"]);
	if (compiled.status !== 0) throw new Error(compiled.stderr);
	const key = busiestKey(files, catalogs);
	const commands = {
		check: {
			args: ["check", "--json"],
			assert: (run) => assertExited(run, [0, 1]),
		},
		find: { args: ["find", key], assert: (run) => assertExited(run, [0]) },
		rename: {
			args: ["rename", key, `${key}_x`],
			assert: (run) => assertExited(run, [0]),
		},
		"check --fix": {
			args: ["check", "--fix"],
			before: () => addUnusedKeys(dir, catalogs),
			assert: (run) => assertExited(run, [0, 1]),
		},
	};
	return { project, files, key, commands };
}

/**
 * Puts the project back as it was, its output compiled again, and for a cold run removes what grai
 * keeps between commands.
 */
function restore(dir, { project, files }, mode) {
	for (const [file, text] of files)
		if (readFileSync(join(dir, file), "utf8") !== text)
			writeFileSync(join(dir, file), text);
	const compiled = cli(dir, ["compile"]);
	if (compiled.status !== 0) throw new Error(compiled.stderr);
	if (mode === "cold")
		for (const kept of ["facts", "files"])
			rmSync(join(dir, project.outdir, ".grai", kept), { force: true });
}

/** A command's runs, cold and warm, in rounds: each mode's median, its samples and the rounds. */
async function timed(dir, prepared, command, rounds) {
	const { args, before, assert } = prepared.commands[command];
	const kept = await inRounds(modes, rounds, (mode) => {
		restore(dir, prepared, mode);
		before?.();
		const run = cli(dir, args);
		assert(run);
		return run.ms;
	});
	const figures = { ran: `grai ${args.join(" ")}` };
	for (const mode of modes) {
		const samples = kept.map((round) => round.measured.get(mode));
		figures[mode] = median(samples);
		figures[`${mode}Samples`] = {
			median: median(samples),
			...medianInterval(samples),
			samples,
		};
	}
	figures.rounds = roundsRecord(kept);
	return figures;
}

const rounds = roundCount(modes.length, 3);
for (const app of process.argv.length > 2
	? process.argv.slice(2)
	: ["synthetic"]) {
	const dir = mkdtempSync(join(tmpdir(), `grai-refactor-${app}-`));
	try {
		const prepared = prepareProject(app, dir);
		const rows = {};
		for (const command of Object.keys(prepared.commands))
			rows[command] = await timed(dir, prepared, command, rounds);
		const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
		const range = ({ median, low, high }) =>
			`${s(median)} (${s(low)}–${s(high)})`;
		console.log(
			`\n### ${app}: grai's commands, each ${CLOCK}, ${rounds} rounds of a cold and a warm run in rotating order, medians (intervals); cold: ${COLD}\n`,
		);
		console.log("| command | cold | warm |\n|---|---|---|");
		for (const figures of Object.values(rows))
			console.log(
				`| ${figures.ran} | ${range(figures.coldSamples)} | ${range(figures.warmSamples)} |`,
			);
		recordResults(`refactor-${app}`, rows, {
			runs: rounds,
			key: prepared.key,
			clock: CLOCK,
			cold: COLD,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
