// Compile time: what a developer waits for, per library, each measurement a new Node process
// (compile-runs.mjs) timed once the library's modules have loaded, from the same restored catalogs
// and no output, no cache.
// - grai, from its build: a full compile; the same compile again with nothing changed; one message
//   edited, compiled again by `recompile` from the build a compile before it kept, as its Vite
//   plugin and `grai watch` compile an edit.
// - Paraglide's compiler in its production layout, message modules: a full compile without
//   declarations, and with them, which it emits through TypeScript 6. Its TypeScript 7 path is not
//   what grai is compared against yet.
// - Paraglide's Vite plugin as a dev server drives it, in the layout it takes in development, locale
//   modules: its first compile, and one message edited, compiled again by its `watchChange` from
//   the compilation it kept, writing only the files that changed; without declarations and with
//   them through TypeScript 6.
// - formatjs's CLI compiling one locale's ICU catalog to an AST, its process included.
// The edit is the same each time: one message of plain words in the locale benches show beside the
// base one, its text prefixed. The variants take turns in rounds whose order rotates (rounds.mjs),
// every sample is kept with its round's load, and Paraglide's figures are paired with grai's of
// the same round. Outside the clocks, each output's texts are checked, every key in every locale
// with the edit (compiled-texts.mjs), and its declarations by TypeScript, or that it has none where
// none were asked for (compiled-declarations.mjs).
//   node compile-time.mjs [app...]      ROUNDS=<multiple of 6> to change the rounds
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { selectedApps } from "./apps.mjs";
import {
	checkDeclarations,
	checkNoDeclarations,
} from "./compiled-declarations.mjs";
import { writeGraiProject } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { median, medianInterval } from "./medians.mjs";
import { writeProject } from "./paraglide.mjs";
import { writeReference } from "./reference-texts.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";
import {
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

const runner = new URL("compile-runs.mjs", import.meta.url).pathname;
const formatjs = new URL("node_modules/.bin/formatjs", import.meta.url)
	.pathname;
/**
 * How long one measurement may take: Paraglide's plugin with declarations compiles twice, minutes
 * each.
 */
const PATIENCE_MS = 30 * 60_000;
/**
 * Paraglide's plugin takes its development layout, and reports a failed compile, only outside
 * production.
 */
const developmentEnv = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => name !== "NODE_ENV"),
);

const paraglide = "Paraglide, message modules";
const plugin = "Paraglide's Vite plugin in dev, locale modules";
const withDeclarations = "declarations through TypeScript 6";
const withoutDeclarations = "without declarations";

/** The variants, by the label each row carries, and how compile-runs.mjs measures each. */
const variants = {
	grai: { run: "grai", declarations: true },
	[`${paraglide}, ${withoutDeclarations}`]: {
		run: "paraglide-compiler",
		outputStructure: "message-modules",
		declarations: false,
	},
	[`${paraglide}, ${withDeclarations}`]: {
		run: "paraglide-compiler",
		outputStructure: "message-modules",
		declarations: true,
	},
	[`${plugin}, ${withoutDeclarations}`]: {
		run: "paraglide-plugin",
		declarations: false,
	},
	[`${plugin}, ${withDeclarations}`]: {
		run: "paraglide-plugin",
		declarations: true,
	},
	formatjs: { run: "formatjs" },
};
const names = Object.keys(variants);
const measures = ["cold", "noop", "edit"];

/** grai's project, Paraglide's on the same copy of the catalogs, and the edit both get. */
function writeProjects(app) {
	const config = writeGraiProject(app, "compile-time");
	const directory = dirname(config);
	const catalogs = Object.fromEntries(
		app.locales.map((locale) => [
			locale,
			join(directory, "messages", `${locale}.json`),
		]),
	);
	const locale = otherLocale(app);
	const words = (name) =>
		typeof app.messages[locale][name] === "string" &&
		!app.messages[locale][name].includes("{");
	const key = Object.keys(app.messages[locale]).find(words);
	return {
		config,
		directory,
		catalogs,
		project: writeProject({ ...app, catalogs }, directory),
		edit: {
			catalog: catalogs[locale],
			locale,
			key,
			text: `Edited: ${app.messages[locale][key]}`,
		},
	};
}

/** Puts back the app's catalogs and removes every output and cache, as before the first compile. */
function restore(app, { directory, catalogs, project }) {
	for (const locale of app.locales)
		cpSync(app.catalogs[locale], catalogs[locale]);
	for (const each of ["out", "paraglide", "ast.json"])
		rmSync(join(directory, each), { recursive: true, force: true });
	rmSync(join(project, "cache"), { recursive: true, force: true });
}

/** formatjs's CLI on one locale's ICU catalog, its process included; it must write every key. */
function formatjsRun({ directory, icu, icuKeys }) {
	const ast = join(directory, "ast.json");
	const start = performance.now();
	execFileSync(formatjs, [
		...["compile", icu, "--format", "simple", "--ast", "--ignore-tag"],
		...["--out-file", ast],
	]);
	const cold = performance.now() - start;
	const written = Object.keys(JSON.parse(readFileSync(ast, "utf8"))).length;
	if (written !== icuKeys)
		throw new Error(`formatjs wrote ${written} keys of ${icuKeys}.`);
	return { cold };
}

/** One measurement of a variant in a process of its own, its output checked after. */
function measure(app, setup, name) {
	restore(app, setup);
	const variant = variants[name];
	if (variant.run === "formatjs") return formatjsRun(setup);
	const outdir = join(
		setup.directory,
		variant.run === "grai" ? "out" : "paraglide",
	);
	const { config, project, edit, reference } = setup;
	const output = execFileSync(
		process.execPath,
		[
			runner,
			JSON.stringify({
				...variant,
				...{ config, project, outdir, edit, reference },
				compilerOptions: app.compilerOptions,
			}),
		],
		{
			encoding: "utf8",
			env: developmentEnv,
			stdio: ["ignore", "pipe", "inherit"],
			maxBuffer: 1 << 26,
			timeout: PATIENCE_MS,
		},
	);
	if (variant.declarations)
		checkDeclarations(setup.directory, outdir, setup.calls);
	else checkNoDeclarations(outdir);
	return JSON.parse(output.trim().split("\n").at(-1));
}

/** A variant's samples of each measure, in the rounds' order, with their median and interval. */
function summary(kept, name) {
	const measured = {};
	for (const each of measures) {
		const samples = kept.map((round) => round.measured.get(name)[each]);
		if (samples[0] === undefined) continue;
		measured[each] = {
			median: median(samples),
			...medianInterval(samples),
			samples,
		};
	}
	return measured;
}

/** Each Paraglide variant's figures over grai's of the same round: a full compile, and the edit. */
function ratios(summaries) {
	const paired = {};
	for (const name of names.filter((each) => each.startsWith("Paraglide")))
		for (const each of ["cold", "edit"]) {
			const figures = summaries[name][each];
			if (figures !== undefined)
				paired[`${name}, ${each}`] = pairedRatio(
					figures.samples,
					summaries.grai[each].samples,
				);
		}
	return paired;
}

const ms = (value) =>
	value < 1000 ? `${value.toFixed(0)} ms` : `${(value / 1000).toFixed(1)} s`;
const cell = (figure) =>
	figure === undefined
		? "—"
		: `${ms(figure.median)} (${ms(figure.low)}–${ms(figure.high)})`;

function print(app, rounds, summaries, paired) {
	console.log(
		`\n### ${app.name}: compile time, each measurement a new Node ${process.versions.node} process, ${rounds} rounds in rotating order, medians (intervals)\n`,
	);
	console.log(
		"| variant | full compile | nothing changed | one message edited | full compile, × grai's | edit, × grai's |\n|---|---|---|---|---|---|",
	);
	for (const name of names) {
		const each = summaries[name];
		const ratio = (measure) => {
			const figure = paired[`${name}, ${measure}`];
			return figure === undefined ? "" : ratioText(figure);
		};
		console.log(
			`| ${name} | ${cell(each.cold)} | ${cell(each.noop)} | ${cell(each.edit)} | ${ratio("cold")} | ${ratio("edit")} |`,
		);
	}
}

const recorded = [];
let rounds;
for (const app of selectedApps()) {
	const setup = writeProjects(app);
	setup.reference = join(setup.directory, "reference.json");
	setup.calls = await writeReference(app, setup.reference);
	const icu = libraryCatalogs(app, setup.edit.locale).icu;
	setup.icu = join(setup.directory, `${setup.edit.locale}.icu.json`);
	setup.icuKeys = Object.keys(icu).length;
	writeFileSync(setup.icu, JSON.stringify(icu));
	rounds = roundCount(names.length);
	const kept = await inRounds(names, rounds, (name) =>
		measure(app, setup, name),
	);
	restore(app, setup);
	const summaries = Object.fromEntries(
		names.map((name) => [name, summary(kept, name)]),
	);
	const paired = ratios(summaries);
	print(app, rounds, summaries, paired);
	const medianOf = (name, each) => summaries[name][each].median;
	const dev = (declarations) => ({
		cold: medianOf(`${plugin}, ${declarations}`, "cold"),
		edit: medianOf(`${plugin}, ${declarations}`, "edit"),
	});
	recorded.push({
		app: app.name,
		keys: Object.keys(app.messages[app.baseLocale]).length,
		edited: { locale: setup.edit.locale, key: setup.edit.key },
		grai: {
			cold: medianOf("grai", "cold"),
			noop: medianOf("grai", "noop"),
			edit: medianOf("grai", "edit"),
		},
		// The full compiles, by the names scripts/charts reads them by.
		paraglide: {
			"message modules, without declarations": medianOf(
				`${paraglide}, ${withoutDeclarations}`,
				"cold",
			),
			"message modules, with declarations": medianOf(
				`${paraglide}, ${withDeclarations}`,
				"cold",
			),
			"locale modules, with declarations": medianOf(
				`${plugin}, ${withDeclarations}`,
				"cold",
			),
		},
		paraglideDev: {
			[withoutDeclarations]: dev(withoutDeclarations),
			[withDeclarations]: dev(withDeclarations),
		},
		formatjs: medianOf("formatjs", "cold"),
		variants: summaries,
		ratios: paired,
		rounds: roundsRecord(kept),
	});
}
recordResults("compile-time", recorded, { runs: rounds });
