// Server shapes: what else a server build could hold its keys in, and what each costs a server.
// Every key of a catalog, from the compiler's model, in four shapes, each bundled with a page of
// the sample's static calls (server-page.mjs):
//   exports  an export per key, as grai's Vite plugin builds them for a server
//   json     the same, with the text keys' strings read from one JSON string
//   object   one object `m` of every key, with no binding per key
//   table    that object, with the text keys' strings read from one JSON string
// Each page loads in a new Node process and renders the sample twice, cold (median of nine) and
// with Node's compile cache warm (median of five). Then a call's cost: the page's render timed in
// a new process once the engine has optimized it (measure.mjs), median of three.
//   node server-shapes.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import { cacheDir, selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { nanosecondsPer } from "./measure.mjs";
import { otherLocale } from "./request.mjs";
import { pageCode } from "./server-page.mjs";

const LOADS = 9;
const CACHED_LOADS = 5;
const CALL_RUNS = 3;
const CALLS = 2000;

/** Each shape's module and how a page calls it, from the compiler's model of every key. */
async function shapes(app) {
	const config = writeGraiProject(app, "server-shapes");
	const { recompile } = await import(join(graiSource, "compile.ts"));
	const { calledNames, everyName, outputImports } = await import(
		join(graiSource, "output-imports.ts")
	);
	const { keyExports } = await import(join(graiSource, "key-exports.ts"));
	const { build, result } = await recompile(config, undefined);
	if (build === undefined) throw new Error(result.errors[0].message);
	const outdir = join(config, "..", "out");
	const keys = [...build.compilation.keys];
	const names = calledNames(build.compilation.keys.values(), [
		"markup",
		"message",
		"text",
	]);
	const imports = outputImports(
		names,
		(file) => join(outdir, file),
		build.rendered.modules,
	);
	const taken = new Set([...everyName(names), "texts", "m", "key"]);
	const texts = keys.filter(([, key]) => key.kind === "text");
	const functions = keys.filter(([, key]) => key.kind !== "text");
	const json = `{${texts.map(([name, key]) => `${JSON.stringify(name)}:[${key.variants.join(",")}]`).join(",")}}`;
	const parsed = `const texts = JSON.parse(${JSON.stringify(json)});`;
	const exported = (list, value) =>
		keyExports(
			list.map(([name, key]) => ({ name, value: value(name, key) })),
			taken,
		);
	const server = (_, key) => key.serverValue;
	const fromJson = (name) => `text(...texts[${JSON.stringify(name)}])`;
	// Written plainly in a literal, `__proto__` would set the object's prototype.
	const property = (name) => (name === "__proto__" ? `["${name}"]` : name);
	const entries = (list) =>
		list
			.map(([name, key]) => `\t${property(name)}: ${key.serverValue},`)
			.join("\n");
	const object = (list) =>
		`const m = {\n\t__proto__: null,\n${entries(list)}\n};`;
	const every = keys.map(([name]) => name);
	return {
		exports: [`${imports}\n${exported(keys, server)}`, "options", every],
		json: [
			`${imports}\n${parsed}\n${exported(functions, server)}${exported(texts, fromJson)}`,
			"options",
			every,
		],
		object: [`${imports}\n${object(keys)}\nexport { m };\n`, "m", ["m"]],
		table: [
			`${imports}\n${object(functions)}\n${parsed}\nfor (const key in texts) m[key] = text(...texts[key]);\nexport { m };\n`,
			"m",
			["m"],
		],
	};
}

/** A shape's page bundled with the shape into one file, as a server build holds them. */
async function bundled(directory, name, [source, mode, names], keys) {
	const shape = join(directory, `${name}.js`);
	const page = join(directory, `${name}-page.js`);
	writeFileSync(shape, source);
	writeFileSync(page, pageCode(shape, mode, names, keys));
	const build = await rolldown({
		input: page,
		platform: "node",
		logLevel: "silent",
	});
	const file = join(directory, `${name}.mjs`);
	await build.write({ format: "esm", file });
	await build.close();
	return file;
}

/** Runs in the child: one load and two renders, or a call's cost, as JSON. */
async function child(kind, module, valuesFile, locale) {
	const values = JSON.parse(readFileSync(valuesFile, "utf8"));
	const options = { locale };
	const start = performance.now();
	const { render } = await import(pathToFileURL(module).href);
	const loaded = performance.now();
	if (kind === "calls") {
		const ns = nanosecondsPer(() => render(values, options), values.length);
		console.log(JSON.stringify({ ns }));
		return;
	}
	render(values, options);
	const first = performance.now();
	render(values, options);
	const warm = performance.now();
	console.log(
		JSON.stringify({
			load: loaded - start,
			first: first - loaded,
			warm: warm - first,
		}),
	);
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const self = new URL(import.meta.url).pathname;
const run = (args, compileCache) =>
	JSON.parse(
		execFileSync(process.execPath, [self, "--child", ...args], {
			encoding: "utf8",
			env: { ...process.env, NODE_COMPILE_CACHE: compileCache },
		}),
	);

/** Each module's runs, interleaved: a run of each, then the next round in the other order. */
function interleaved(modules, rounds, measure) {
	const runs = modules.map(() => []);
	for (let round = 0; round < rounds; round++) {
		const order = modules.map((_, index) => index);
		if (round % 2 === 1) order.reverse();
		for (const index of order) runs[index].push(measure(modules[index], index));
	}
	return runs;
}

async function benchApp(app) {
	const directory = join(cacheDir, "server-shapes", `${app.id}-pages`);
	mkdirSync(directory, { recursive: true });
	const calls = sampleCalls(app, CALLS);
	const valuesFile = join(directory, "values.json");
	writeFileSync(valuesFile, JSON.stringify(calls.map((call) => call.inputs)));
	const keys = calls.map((call) => call.key);
	const locale = otherLocale(app);
	const named = Object.entries(await shapes(app));
	const modules = [];
	for (const [name, shape] of named)
		modules.push(await bundled(directory, name, shape, keys));
	const args = (module, kind = "load") => [kind, module, valuesFile, locale];
	const cold = interleaved(modules, LOADS, (module) => run(args(module)));
	const caches = modules.map((_, index) =>
		join(directory, `compile-cache-${index}`),
	);
	for (const [index, module] of modules.entries()) {
		rmSync(caches[index], { recursive: true, force: true });
		run(args(module), caches[index]);
	}
	const cached = interleaved(modules, CACHED_LOADS, (module, index) =>
		run(args(module), caches[index]),
	);
	const optimized = interleaved(modules, CALL_RUNS, (module) =>
		run(args(module, "calls")),
	);
	const ms = (runs, field) =>
		`${median(runs.map((each) => each[field])).toFixed(1)} ms`;
	named.forEach(([name], index) => {
		console.log(
			`| ${app.name} | ${name} | ${ms(cold[index], "load")} | ${ms(cold[index], "warm")} | ${ms(cached[index], "load")} | ${median(optimized[index].map((each) => each.ns)).toFixed(1)} ns |`,
		);
	});
}

if (process.argv[2] === "--child") await child(...process.argv.slice(3));
else {
	console.log(
		`\n### every key with a page of the sample's calls, in one file, a new Node ${process.versions.node} process\n`,
	);
	console.log(
		"| catalog | shape | load | second render | load, compile cache warm | a call, optimized |",
	);
	console.log("|---|---|---|---|---|---|");
	for (const app of selectedApps()) await benchApp(app);
}
