// The time i18n adds to a production build: one app (build-apps.mjs) built by Vite on grai, on
// Paraglide, and with every message written in, each build a new Node process from a clean
// checkout, no output and no cache, as CI builds it. What a library adds is its build less the
// build without i18n, made of:
// - its compile, catalogs to output, which both plugins run in `buildStart`: timed alone, in a new
//   process as the build is, its modules loaded first;
// - the rest: its plugin's other work and the bundler's on its message modules.
// Rolldown's own timing of the plugins' hooks (`checks.bundlerTimings`, bundler-timings.mjs) is
// kept beside them, for each hook it names: one of a second or more. Vite times plugins only in its
// dev server. The builds take turns, RUNS rounds of the three, so the load from other work weighs
// on each alike; medians. After each build, every page of it is opened in Chromium and must draw
// its texts (built-pages.mjs).
//   node build-added.mjs [app...]      synthetic and synthetic-13326 by default
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { writeBuildApps } from "./build-apps.mjs";
import { checkBuiltPages } from "./built-pages.mjs";
import { bundlerTimings } from "./bundler-timings.mjs";
import { graiEntry } from "./grai.mjs";
import { recordResults } from "./results.mjs";

const RUNS = 5;
const self = new URL(import.meta.url).pathname;
const variants = ["stub", "grai", "paraglide"];
/** Each library's plugin, as Rolldown names it. */
const plugins = { grai: "grai", paraglide: "unplugin-paraglide-js" };

/** What a build starts from, as a fresh checkout: each library's output and cache gone. */
function clean(root) {
	for (const each of [
		"dist",
		"src/i18n",
		"src/paraglide",
		"project.inlang/cache",
	])
		rmSync(join(root, each), { recursive: true, force: true });
}

/** The library's compile alone, catalogs to output, loaded and ready to call. */
async function compiler(variant, root, extra) {
	if (variant === "grai") {
		const { compile } = await import(graiEntry("."));
		return async () => {
			const result = await compile(extra);
			if (result.errors.length > 0) throw result.errors[0];
		};
	}
	const { compile } = await import("@inlang/paraglide-js");
	return () =>
		compile({
			project: extra,
			outdir: join(root, "src/paraglide"),
			emitGitIgnore: false,
			emitPrettierIgnore: false,
			emitReadme: false,
		});
}

/** One build, as Vite builds the app for production, with the report Rolldown logs, if any. */
async function buildOnce(variant, root, extra) {
	const { build } = await import("vite");
	const plugins =
		variant === "grai"
			? [(await import(graiEntry("./vite"))).grai({ config: extra })]
			: variant === "paraglide"
				? [
						(await import("@inlang/paraglide-js")).paraglideVitePlugin({
							project: extra,
							outdir: join(root, "src/paraglide"),
						}),
					]
				: [];
	let timings;
	const quiet = () => {};
	const customLogger = {
		info: quiet,
		warn: (message) => {
			timings ??= bundlerTimings(message);
		},
		warnOnce: quiet,
		error: quiet,
		clearScreen: quiet,
		hasErrorLogged: () => false,
		hasWarned: false,
	};
	const start = performance.now();
	await build({
		root,
		configFile: false,
		customLogger,
		plugins,
		build: { outDir: join(root, "dist"), reportCompressedSize: false },
	});
	return { ms: performance.now() - start, timings };
}

/** Runs in the child: one build or one compile, timed after its modules load, printed as JSON. */
async function child(task, variant, root, extra) {
	clean(root);
	if (task === "compile") {
		const compile = await compiler(variant, root, extra);
		const start = performance.now();
		await compile();
		console.log(JSON.stringify({ ms: performance.now() - start }));
		return;
	}
	console.log(JSON.stringify(await buildOnce(variant, root, extra)));
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** One task in a new process, its result. */
function run(task, variant, root, extra) {
	const output = execFileSync(
		process.execPath,
		[self, "--child", task, variant, root, extra ?? ""],
		{ cwd: root, encoding: "utf8" },
	);
	return JSON.parse(output.trim().split("\n").at(-1));
}

/** The plugin's hooks Rolldown names in a build's report, and their time: none under a second. */
function reported(build, plugin) {
	return (build.timings?.hooks ?? []).filter((each) => each.plugin === plugin);
}

/** One app's builds and compiles, as results/build-added.json has them. */
async function measure(browser, app) {
	const { roots, graiConfig, project, calls, pages } =
		await writeBuildApps(app);
	const extra = { stub: undefined, grai: graiConfig, paraglide: project };
	const builds = { stub: [], grai: [], paraglide: [] };
	const compiles = { grai: [], paraglide: [] };
	for (let round = 0; round < RUNS; round++) {
		const order = variants.map(
			(_, index) => variants[(index + round) % variants.length],
		);
		for (const variant of order) {
			builds[variant].push(
				run("build", variant, roots[variant], extra[variant]),
			);
			await checkBuiltPages(browser, join(roots[variant], "dist"), pages);
		}
		for (const library of round % 2 === 0
			? ["grai", "paraglide"]
			: ["paraglide", "grai"])
			compiles[library].push(
				run("compile", library, roots[library], extra[library]).ms,
			);
	}
	const ms = (variant) => median(builds[variant].map((each) => each.ms));
	const stub = ms("stub");
	const measured = {
		app: app.name,
		keys: Object.keys(app.messages[app.baseLocale]).length,
		calls,
		stub: { build: stub, runs: builds.stub.map((each) => each.ms) },
	};
	for (const [library, plugin] of Object.entries(plugins)) {
		const build = ms(library);
		const compile = median(compiles[library]);
		measured[library] = {
			build,
			added: build - stub,
			compile,
			rest: build - stub - compile,
			hooks: builds[library].map((each) => reported(each, plugin)),
			runs: {
				builds: builds[library].map((each) => each.ms),
				compiles: compiles[library],
			},
		};
	}
	return measured;
}

if (process.argv[2] === "--child") {
	await child(...process.argv.slice(3));
} else {
	const names = process.argv.slice(2);
	const browser = await chromium.launch();
	const recorded = [];
	for (const app of selectedApps(
		names.length > 0 ? names : ["synthetic", "synthetic-13326"],
	)) {
		const measured = await measure(browser, app);
		recorded.push(measured);
		console.log(
			`\n### ${app.name}: ${measured.calls} calls on its pages, ms, medians of ${RUNS}\n`,
		);
		console.log(
			"| | build | added by i18n | its compile | the rest | hooks Rolldown names in the median build |",
		);
		console.log("|---|---|---|---|---|---|");
		console.log(`| no i18n | ${measured.stub.build.toFixed(0)} | | | | |`);
		for (const library of Object.keys(plugins)) {
			const each = measured[library];
			const named =
				each.hooks[each.runs.builds.indexOf(each.build)]
					.map((hook) => `${hook.hook} ${hook.ms.toFixed(0)}`)
					.join(", ") || "none of 1 s or more";
			console.log(
				`| ${library} | ${each.build.toFixed(0)} | ${each.added.toFixed(0)} | ${each.compile.toFixed(0)} | ${each.rest.toFixed(0)} | ${named} |`,
			);
		}
	}
	await browser.close();
	recordResults("build-added", recorded, { runs: RUNS });
}
