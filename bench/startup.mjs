// Startup: what a new server process pays before and during its first render, per library. It
// loads every locale's messages (each library's modules and catalogs bundled into one file with a
// page of the sample's static calls, as a server build holds them, and the instances made from
// them; server-page.mjs), renders the 2,000-call sample once cold, which is where use-intl parses
// each message it meets, and once warm, and reports the heap it all holds. Each measurement is a
// new Node process, then a new Node process with Node's compile cache warm, then a new workerd
// (startup-workerd.mjs); medians of five.
//   node startup.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { rolldown } from "rolldown";
import { build } from "vite";
import { cacheDir, selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { paraglideOutput } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";
import { pageCode } from "./server-page.mjs";
import { inWorkerd, workerFiles } from "./startup-workerd.mjs";

const RUNS = 5;
const CALLS = 2000;

/** Runs in the child: loads a page, renders the sample twice, prints times and heap. */
async function child(module, file, locale) {
	const values = JSON.parse(readFileSync(file, "utf8")).map(
		(call) => call.values,
	);
	const options = { locale };
	globalThis.gc();
	const heapBefore = process.memoryUsage().heapUsed;
	const start = performance.now();
	const { render } = await import(module);
	const imported = performance.now();
	render(values, options);
	const first = performance.now();
	render(values, options);
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

/**
 * A page of the sample's calls through a module, and everything it imports, bundled into one file
 * as a server build holds them.
 */
async function bundled(app, name, entry, mode, callsFile) {
	const names = mode === "t" ? ["t"] : Object.keys(await import(entry));
	const keys = JSON.parse(readFileSync(callsFile, "utf8")).map(
		(call) => call.key,
	);
	const page = join(cacheDir, `startup-${app.id}-${name}-page.js`);
	writeFileSync(page, pageCode(entry, mode, names, keys));
	const build = await rolldown({
		input: page,
		platform: "node",
		logLevel: "silent",
	});
	const file = join(cacheDir, `startup-${app.id}-${name}.mjs`);
	await build.write({ format: "esm", file });
	await build.close();
	return file;
}

/** Every key of a compiled project as grai's Vite plugin builds them for a server. */
async function viteServerBuild(config) {
	const { grai } = await import(join(graiSource, "vite.ts"));
	const root = dirname(config);
	const entry = join(root, "server-entry.js");
	writeFileSync(entry, `export * from "./out/keys.js";\n`);
	await build({
		root,
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ config })],
		build: { ssr: entry, outDir: join(root, "server") },
	});
	return join(root, "server", "server-entry.js");
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function benchApp(app) {
	const locale = otherLocale(app);
	const sample = sampleCalls(app, CALLS);
	mkdirSync(cacheDir, { recursive: true });
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
			"grai, every locale (its Vite plugin's server build)",
			await viteServerBuild(config),
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
	const modules = [];
	for (const [index, [name, entry, mode, file]] of rows.entries())
		modules.push({
			name,
			mode,
			file,
			module: await bundled(app, String(index), entry, mode, file),
		});
	console.log(
		`\n### ${app.name}, ${locale}: a new Node ${process.versions.node} process, median of ${RUNS}\n`,
	);
	console.log(
		"| library | load messages | first render, 2,000 calls | warm render | heap held |",
	);
	console.log("|---|---|---|---|---|");
	for (const row of modules) {
		const runs = Array.from({ length: RUNS }, () => inNode(row, locale));
		const heap = median(runs.map((run) => run.heap)) / 1024 / 1024;
		console.log(
			`| ${row.name} | ${times(runs).join(" | ")} | ${heap.toFixed(1)} MB |`,
		);
	}
	console.log(
		`\n### ${app.name}, ${locale}: a new Node process, Node's compile cache warm, median of ${RUNS}\n`,
	);
	console.log(
		"| library | load messages | first render, 2,000 calls | warm render |",
	);
	console.log("|---|---|---|---|");
	for (const row of modules) {
		const cache = join(cacheDir, "compile-cache", basename(row.module, ".mjs"));
		rmSync(cache, { recursive: true, force: true });
		inNode(row, locale, cache);
		const runs = Array.from({ length: RUNS }, () => inNode(row, locale, cache));
		console.log(`| ${row.name} | ${times(runs).join(" | ")} |`);
	}
	console.log(
		`\n### ${app.name}, ${locale}: a new workerd, median of ${RUNS}, to the millisecond its timer gives\n`,
	);
	console.log(
		"| library | load messages | first render, 2,000 calls | warm render |",
	);
	console.log("|---|---|---|---|");
	for (const { name, file, module } of modules) {
		const worker = workerFiles(module, file, locale);
		const runs = [];
		for (let run = 0; run < RUNS; run++) runs.push(await inWorkerd(worker));
		console.log(`| ${name} | ${times(runs, 0).join(" | ")} |`);
	}
}

/**
 * Loads a row's module in a new Node process and renders the sample there: the times and heap it
 * reports. With `compileCache`, the process reads and writes Node's compile cache in it.
 */
function inNode({ module, file }, locale, compileCache) {
	const args = [
		"--expose-gc",
		new URL(import.meta.url).pathname,
		"--child",
		module,
		file,
		locale,
	];
	const env = { ...process.env, NODE_COMPILE_CACHE: compileCache };
	return JSON.parse(
		execFileSync(process.execPath, args, { encoding: "utf8", env }),
	);
}

/** The median load, first render and warm render of some runs, to `digits` decimals. */
const times = (runs, digits = 1) =>
	["load", "first", "warm"].map(
		(field) => `${median(runs.map((run) => run[field])).toFixed(digits)} ms`,
	);

if (process.argv[2] === "--child") await child(...process.argv.slice(3));
else for (const app of selectedApps()) await benchApp(app);
