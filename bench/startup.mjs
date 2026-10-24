// Startup: what a new server process pays before and during its first render, per library. It
// loads every locale's messages (each library's modules and catalogs bundled into one file, as a
// server build holds them, and the instances made from them), renders the 2,000-call
// sample once cold, which is where use-intl parses each message it meets, and once warm, and
// reports the heap it all holds. Each measurement is a new Node process; medians of five.
//   node startup.mjs [app...]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rolldown } from "rolldown";
import { cacheDir, selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { paraglideOutput } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";

const RUNS = 5;
const CALLS = 2000;

/** How each kind of module renders one call. */
const callers = {
	t: (loaded) => (key, values) => loaded.t(key, values),
	module: (loaded) => (key, values) => loaded[key](values),
	options: (loaded, locale) => {
		const options = { locale };
		return (key, values) => loaded[key](values, options);
	},
};

/** Runs in the child: loads `module`, renders the sample twice, prints times and heap. */
async function child(module, mode, file, locale) {
	const calls = JSON.parse(readFileSync(file, "utf8"));
	globalThis.gc();
	const heapBefore = process.memoryUsage().heapUsed;
	const start = performance.now();
	const loaded = await import(module);
	const imported = performance.now();
	const call = callers[mode](loaded, locale);
	const render = () => {
		let text = "";
		for (const { key, values } of calls) text += call(key, values);
		return text;
	};
	const inLocale = (work) =>
		loaded.withLocale ? loaded.withLocale(locale, work) : work();
	inLocale(render);
	const first = performance.now();
	inLocale(render);
	const warm = performance.now();
	globalThis.gc();
	const heap = process.memoryUsage().heapUsed - heapBefore;
	console.log(
		JSON.stringify({
			load: imported - start,
			first: first - imported,
			warm: warm - first,
			heap,
		}),
	);
}

/** A module holding every locale's instance of a library, whose `t` is `locale`'s, as a server holds them. */
function everyLocale(app, library, locale) {
	const imports = app.locales.map(
		(each, index) =>
			`import { t as t${index} } from ${JSON.stringify(join(writeLibraryModules(app, each).directory, `${each}.${library}.js`))};`,
	);
	const file = join(cacheDir, `startup-${app.id}-${library}-every-locale.js`);
	writeFileSync(
		file,
		`${imports.join("\n")}\nexport const t = t${app.locales.indexOf(locale)};\nexport const others = [${app.locales.map((_, index) => `t${index}`).join(", ")}];\n`,
	);
	return file;
}

/** A module and everything it imports bundled into one file, as a server build holds them. */
async function bundled(app, name, entry) {
	const build = await rolldown({
		input: entry,
		platform: "node",
		logLevel: "silent",
	});
	const file = join(cacheDir, `startup-${app.id}-${name}.mjs`);
	await build.write({ format: "esm", file });
	await build.close();
	return file;
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function benchApp(app) {
	const locale = otherLocale(app);
	const sample = sampleCalls(app, CALLS);
	const callsFile = (name, values) => {
		const path = join(cacheDir, `startup-${app.id}-${name}.json`);
		writeFileSync(
			path,
			JSON.stringify(
				sample.map((call) => ({ key: call.key, values: values(call) })),
			),
		);
		return path;
	};
	const plain = callsFile("plain", (call) => call.inputs);
	const forI18next = callsFile("i18next", (call) =>
		i18nextValues(app, call.key, call.inputs),
	);
	const prototype = writePrototype(app);
	const config = writeGraiProject(app, "startup");
	const { compile } = await import(join(graiSource, "index.ts"));
	await compile(config);
	const rows = [
		[
			"grai, one locale (the browser's per-locale module)",
			join(prototype, `${locale}.js`),
			"module",
			plain,
		],
		[
			"grai, every locale (the compiler's output)",
			join(config, "..", "out", "keys.js"),
			"options",
			plain,
		],
		[
			"Paraglide, every locale",
			join(await paraglideOutput(app), "messages/_index.js"),
			"options",
			plain,
		],
		[
			"i18next, every locale",
			everyLocale(app, "i18next", locale),
			"t",
			forI18next,
		],
		[
			"use-intl, every locale",
			everyLocale(app, "use-intl", locale),
			"t",
			plain,
		],
	];
	console.log(
		`\n### ${app.name}, ${locale}: a new Node ${process.versions.node} process, median of ${RUNS}\n`,
	);
	console.log(
		"| library | load messages | first render, 2,000 calls | warm render | heap held |",
	);
	console.log("|---|---|---|---|---|");
	for (const [index, [name, entry, mode, file]] of rows.entries()) {
		const module = await bundled(app, String(index), entry);
		const runs = Array.from({ length: RUNS }, () => {
			const args = [
				"--expose-gc",
				new URL(import.meta.url).pathname,
				"--child",
				module,
				mode,
				file,
				locale,
			];
			return JSON.parse(
				execFileSync(process.execPath, args, { encoding: "utf8" }),
			);
		});
		const ms = (field) =>
			`${median(runs.map((run) => run[field])).toFixed(1)} ms`;
		const heap = median(runs.map((run) => run.heap)) / 1024 / 1024;
		console.log(
			`| ${name} | ${ms("load")} | ${ms("first")} | ${ms("warm")} | ${heap.toFixed(1)} MB |`,
		);
	}
}

if (process.argv[2] === "--child") await child(...process.argv.slice(3));
else for (const app of selectedApps()) await benchApp(app);
