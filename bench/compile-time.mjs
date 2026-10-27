// Compile time: what a developer waits for, per library, each run a new Node process. grai's
// compile from this repository's source: cold, with nothing to do, and after one edited message.
// Each time starts once the library's modules have loaded.
// Paraglide's compile, without its TypeScript declarations and with them (through TypeScript 6,
// whose API its emit needs). formatjs compiling one locale's ICU catalog to an AST. Edits go to a copy of
// the catalogs under .cache. Medians of three runs; one run for Paraglide's declarations.
//   node compile-time.mjs [app...]
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { resolveTypeScript6, writeProject } from "./paraglide.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const RUNS = 3;
const self = new URL(import.meta.url).pathname;

/** Runs in the child: one compile of the named kind, timed after its modules load, as JSON. */
async function child(kind, ...args) {
	if (kind === "grai") {
		const { compile } = await import(join(graiSource, "index.ts"));
		const [config] = args;
		const start = performance.now();
		const cold = await compile(config);
		const coldMs = performance.now() - start;
		const noopStart = performance.now();
		await compile(config);
		const noopMs = performance.now() - noopStart;
		if (cold.errors.length > 0) throw new Error(cold.errors[0].message);
		console.log(JSON.stringify({ cold: coldMs, noop: noopMs }));
		return;
	}
	if (kind === "grai-edit") {
		const { recompile } = await import(join(graiSource, "compile.ts"));
		const [config, catalog, key] = args;
		const { build } = await recompile(config, undefined);
		const parsed = JSON.parse(readFileSync(catalog, "utf8"));
		parsed[key] = `Edited: ${parsed[key]}`;
		writeFileSync(catalog, JSON.stringify(parsed, null, "\t"));
		const editStart = performance.now();
		const { result } = await recompile(config, build);
		const ms = performance.now() - editStart;
		if (result.errors.length > 0) throw new Error(result.errors[0].message);
		console.log(JSON.stringify({ edit: ms }));
		return;
	}
	const [project, outdir, declarations, strategy, outputStructure] = args;
	if (declarations === "true") resolveTypeScript6();
	const { compile } = await import("@inlang/paraglide-js");
	rmSync(outdir, { recursive: true, force: true });
	const start = performance.now();
	await compile({
		project,
		outdir,
		emitTsDeclarations: declarations === "true",
		strategy: strategy.split(","),
		outputStructure,
		emitGitIgnore: false,
		emitPrettierIgnore: false,
		emitReadme: false,
	});
	console.log(JSON.stringify({ cold: performance.now() - start }));
}

function run(args) {
	return JSON.parse(
		execFileSync(process.execPath, [self, "--child", ...args], {
			encoding: "utf8",
			maxBuffer: 1 << 26,
		})
			.trim()
			.split("\n")
			.at(-1),
	);
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const times = (count, measure) => Array.from({ length: count }, measure);

if (process.argv[2] === "--child") {
	await child(...process.argv.slice(3));
} else {
	const recorded = [];
	for (const app of selectedApps()) {
		const config = writeGraiProject(app, "compile-time");
		const directory = join(config, "..");
		const grai = times(RUNS, () => {
			rmSync(join(directory, "out"), { recursive: true, force: true });
			return run(["grai", config]);
		});
		const locale = otherLocale(app);
		const key = Object.keys(app.messages[locale]).find(
			(name) => typeof app.messages[locale][name] === "string",
		);
		const edits = times(RUNS, () =>
			run([
				"grai-edit",
				config,
				join(directory, "messages", `${locale}.json`),
				key,
			]),
		);
		const project = writeProject(app, directory);
		const strategy = app.compilerOptions.strategy.join(",");
		const paraglide = (declarations, structure, count) =>
			median(
				times(count, () =>
					run([
						"paraglide",
						project,
						join(directory, "paraglide"),
						declarations,
						strategy,
						structure,
					]),
				).map((result) => result.cold),
			);
		const paraglideRows = [
			[
				"message modules, without declarations",
				paraglide("false", "message-modules", RUNS),
			],
			[
				"message modules, with declarations",
				paraglide("true", "message-modules", 1),
			],
			[
				"locale modules, with declarations",
				paraglide("true", "locale-modules", 1),
			],
		];
		const icu = join(directory, `${locale}.icu.json`);
		writeFileSync(icu, JSON.stringify(libraryCatalogs(app, locale).icu));
		const formatjs = times(RUNS, () => {
			const start = performance.now();
			execFileSync(
				join(
					new URL(".", import.meta.url).pathname,
					"node_modules/.bin/formatjs",
				),
				[
					"compile",
					icu,
					"--format",
					"simple",
					"--ast",
					"--ignore-tag",
					"--out-file",
					join(directory, "ast.json"),
				],
			);
			return { cold: performance.now() - start };
		});
		const ms = (value) =>
			value < 1000
				? `${value.toFixed(0)} ms`
				: `${(value / 1000).toFixed(1)} s`;
		console.log(
			`\n### ${app.name}: compile time, a new Node ${process.versions.node} process each\n`,
		);
		console.log(
			"| library | full compile | nothing changed | one message edited |\n|---|---|---|---|",
		);
		console.log(
			`| grai | ${ms(median(grai.map((r) => r.cold)))} | ${ms(median(grai.map((r) => r.noop)))} | ${ms(median(edits.map((r) => r.edit)))} |`,
		);
		for (const [name, cold] of paraglideRows)
			console.log(`| Paraglide, ${name} | ${ms(cold)} | the same | the same |`);
		console.log(
			`| intl-messageformat, \`formatjs compile --ast\`, one locale (optional) | ${ms(median(formatjs.map((r) => r.cold)))} | the same | the same |`,
		);
		console.log(
			"| i18next, use-intl | none, the catalogs are read at run time | | |",
		);
		recorded.push({
			app: app.name,
			keys: Object.keys(app.messages[app.baseLocale]).length,
			grai: {
				cold: median(grai.map((r) => r.cold)),
				noop: median(grai.map((r) => r.noop)),
				edit: median(edits.map((r) => r.edit)),
			},
			paraglide: Object.fromEntries(paraglideRows),
			formatjs: median(formatjs.map((r) => r.cold)),
		});
	}
	recordResults("compile-time", recorded, { runs: RUNS });
}
