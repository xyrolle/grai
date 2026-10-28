// The time i18n adds to a production build: one app (build-apps.mjs) built by Vite on grai, on
// Paraglide, and with every message's text written in, each build a new Node process from a clean
// checkout, no output and no cache, as CI builds it (build-runs.mjs). A build's clock runs from
// before Vite and the library's plugin are imported until the build has written its files: both
// imports and the plugin's construction are in it, Node's own start is not. What a library adds is
// its build less the build without i18n of the same round. Of that, the library's plugins'
// `buildStart`, where both compile the catalogs, is timed around the plugins' own hooks; the rest
// is everything else the library adds, its plugin's import and its other hooks and Rolldown's work
// on its modules, by the same round's subtraction. Rolldown's own report of a plugin hook of a
// second or more (bundler-timings.mjs) is kept beside them. The builds take turns in rounds whose
// order rotates (rounds.mjs), every sample is kept with its round's load, and after each build,
// outside its clock, every page of it is opened in Chromium and must draw its texts
// (built-pages.mjs).
//   node build-added.mjs [app...]   synthetic and synthetic-13326 by default
//   ROUNDS=<multiple of 3> to change the rounds
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { writeBuildApps } from "./build-apps.mjs";
import { checkBuiltPages } from "./built-pages.mjs";
import { median, medianInterval } from "./medians.mjs";
import { recordResults } from "./results.mjs";
import {
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

const runner = new URL("build-runs.mjs", import.meta.url).pathname;
const variants = ["stub", "grai", "paraglide"];
const libraries = ["grai", "paraglide"];
/** Each library's plugin, as Rolldown names it. */
const pluginNames = { grai: "grai", paraglide: "unplugin-paraglide-js" };
const CLOCK =
	"from before Vite and the library's plugin are imported until the build has written its files; Node's own start is not in it";

/** One build in a new process, then each of its pages checked in Chromium. */
async function measure(browser, app, variant) {
	const output = execFileSync(
		process.execPath,
		[runner, variant, app.roots[variant], app.extra[variant] ?? ""],
		{ cwd: app.roots[variant], encoding: "utf8" },
	);
	await checkBuiltPages(browser, join(app.roots[variant], "dist"), app.pages);
	return JSON.parse(output.trim().split("\n").at(-1));
}

/** Samples in the rounds' order, with their median and interval. */
const spread = (samples) => ({
	median: median(samples),
	...medianInterval(samples),
	samples,
});

/** The plugin's hooks Rolldown names in a build's report, and their time: none under a second. */
const reported = (build, plugin) =>
	(build.timings?.hooks ?? []).filter((each) => each.plugin === plugin);

/** One app's rounds, as results/build-added.json has them. */
function summary(app, kept) {
	const of = (variant) => kept.map((round) => round.measured.get(variant));
	const stub = of("stub").map((build) => build.ms);
	const measured = {
		app: app.name,
		keys: Object.keys(app.messages[app.baseLocale]).length,
		calls: app.calls,
		stub: { build: median(stub), runs: stub, builds: spread(stub) },
	};
	for (const library of libraries) {
		const builds = of(library);
		const ms = builds.map((build) => build.ms);
		const added = ms.map((each, round) => each - stub[round]);
		const buildStart = builds.map((build) => build.buildStart);
		const rest = added.map((each, round) => each - buildStart[round]);
		measured[library] = {
			build: median(ms),
			added: median(added),
			compile: median(buildStart),
			rest: median(rest),
			hooks: builds.map((build) => reported(build, pluginNames[library])),
			runs: { builds: ms, compiles: buildStart },
			builds: spread(ms),
			additions: spread(added),
			buildStarts: spread(buildStart),
			rests: spread(rest),
		};
	}
	measured.paraglideOverGrai = pairedRatio(
		measured.paraglide.additions.samples,
		measured.grai.additions.samples,
	);
	measured.rounds = roundsRecord(kept);
	return measured;
}

const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
const range = ({ median, low, high }) => `${s(median)} (${s(low)}–${s(high)})`;

function print(measured, rounds) {
	console.log(
		`\n### ${measured.app}: ${measured.calls} calls on its pages, ${rounds} rounds in rotating order, medians (intervals); each build's clock ${CLOCK}\n`,
	);
	console.log(
		"| | build | added by i18n | its plugins' buildStart | the rest |\n|---|---|---|---|---|",
	);
	console.log(`| no i18n | ${range(measured.stub.builds)} | | | |`);
	for (const library of libraries) {
		const each = measured[library];
		console.log(
			`| ${library} | ${range(each.builds)} | ${range(each.additions)} | ${range(each.buildStarts)} | ${range(each.rests)} |`,
		);
	}
	console.log(
		`\nParaglide adds ${ratioText(measured.paraglideOverGrai)} what grai adds, paired by round.`,
	);
}

const names = process.argv.slice(2);
const browser = await chromium.launch();
const recorded = [];
let rounds;
try {
	for (const app of selectedApps(
		names.length > 0 ? names : ["synthetic", "synthetic-13326"],
	)) {
		const { roots, graiConfig, project, calls, pages } =
			await writeBuildApps(app);
		const built = {
			...app,
			roots,
			calls,
			pages,
			extra: { grai: graiConfig, paraglide: project },
		};
		rounds = roundCount(variants.length, 3);
		const kept = await inRounds(variants, rounds, (variant) =>
			measure(browser, built, variant),
		);
		const measured = summary(built, kept);
		print(measured, rounds);
		recorded.push(measured);
	}
} finally {
	await browser.close();
}
recordResults("build-added", recorded, { runs: rounds, clock: CLOCK });
