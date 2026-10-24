// Client bytes per page: the messages each page of a real build downloads with every locale, against
// only the reader's locale, as Paraglide's per-locale build and as grai's per-locale functions. The
// pages and their keys come from a build record (record-build.mjs). Each scheme is bundled and
// minified by Rolldown from the same keys, so compression is held equal; "page JS" is the brotli
// size of everything the page loads in the build itself, for scale.
//   node bytes.mjs <app> <grai-build.json>
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { rolldown } from "rolldown";
import { selectedApps } from "./apps.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { template, writePrototype } from "./prototype.mjs";

const [appName, recordPath] = process.argv.slice(2);
const [app] = selectedApps([appName]);
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const client = join(record.root, ".svelte-kit/output/client");

function sizes(code) {
	const bytes = Buffer.from(code);
	return {
		raw: bytes.length,
		brotli: brotliCompressSync(bytes, {
			params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
		}).length,
	};
}

/** The key a compiled message module exports, or undefined for any other module. */
const keyOfModule = new Map();
function keyOf(id) {
	if (!/\/paraglide\/messages\/(?!_index)[^/]+\.js$/.test(id)) return undefined;
	if (!keyOfModule.has(id)) {
		const code = readFileSync(id, "utf8");
		keyOfModule.set(
			id,
			code.match(/export \{ \w+ as "([^"]+)" \}/)?.[1] ??
				code.match(/export const (\w+) =/)?.[1],
		);
	}
	return keyOfModule.get(id);
}

const chunks = new Map(record.chunks.map((chunk) => [chunk.file, chunk]));
const nodeChunk = new Map();
for (const chunk of record.chunks) {
	if (chunk.facade && basename(dirname(chunk.facade)) === "nodes")
		nodeChunk.set(Number(basename(chunk.facade, ".js")), chunk.file);
}

/** Chunks and every chunk they import statically, as SvelteKit preloads them. */
function closure(files, into = new Set()) {
	for (const file of files) {
		if (into.has(file)) continue;
		into.add(file);
		closure(chunks.get(file)?.imports ?? [], into);
	}
	return into;
}

/** A file's brotli size as built; Vite drops a chunk that held only CSS after generating it. */
const builtBrotli = new Map();
function brotliOf(file) {
	if (!builtBrotli.has(file))
		builtBrotli.set(
			file,
			existsSync(join(client, file))
				? sizes(readFileSync(join(client, file))).brotli
				: 0,
		);
	return builtBrotli.get(file);
}

// Paraglide's per-locale build compiles this expression and has Vite define it per locale, so the
// minifier folds every other locale away.
const STATIC_LOCALE =
	"/** @type {any} */ (globalThis).__PARAGLIDE_STATIC_LOCALE__";

/**
 * Minified bundle of `keys` exported from `from`. `locale` defines Paraglide's static locale and
 * bundles its runtime, so the fold can happen; otherwise the runtime, shared by every page, stays
 * out of the count.
 */
async function bundled(from, keys, locale, literals = []) {
	const entry = `export { ${keys.map((key) => JSON.stringify(key)).join(", ")} } from ${JSON.stringify(from)}; export const literals = [${literals.join(", ")}];`;
	const bundle = await rolldown({
		input: "entry",
		external: (id) =>
			/\/registry\.js$/.test(id) || (!locale && /\/runtime\.js$/.test(id)),
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? entry : null),
			},
		],
		transform: locale
			? {
					define: {
						"globalThis.__PARAGLIDE_STATIC_LOCALE__": JSON.stringify(locale),
					},
				}
			: undefined,
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm", minify: true });
	await bundle.close();
	return sizes(output[0].code);
}

/** The keys the code a page loads names: what it uses, whatever its chunks hold. */
function usedKeys(files) {
	const keys = new Set();
	for (const file of files) {
		for (const [id, length] of Object.entries(
			chunks.get(file)?.modules ?? {},
		)) {
			if (length === 0 || keyOf(id)) continue;
			for (const key of record.references[id] ?? [])
				if (key in app.messages[app.baseLocale]) keys.add(key);
		}
	}
	return keys;
}

const pages = record.routes.map((route) => {
	const files = closure([
		...record.entry,
		...route.nodes.map((node) => nodeChunk.get(node)).filter(Boolean),
	]);
	const keys = new Set();
	let js = 0;
	for (const file of files) {
		for (const id of Object.keys(chunks.get(file)?.modules ?? {}))
			if (keyOf(id)) keys.add(keyOf(id));
		js += brotliOf(file);
	}
	return { keys: [...keys], used: usedKeys(files).size, js };
});

const everyLocale = join(await paraglideOutput(app), "messages/_index.js");
const perLocaleBuild = join(
	await paraglideOutput(app, { experimentalStaticLocale: STATIC_LOCALE }),
	"messages/_index.js",
);
const prototype = writePrototype(app);

const kb = (bytes) => (bytes / 1024).toFixed(1);
const reader = app.locales.includes("ru") ? "ru" : app.baseLocale;
console.log(
	`\n### ${app.name}: message bytes per page, KB brotli (raw), Paraglide ${paraglideVersion}, one locale = ${reader}\n`,
);
console.log(
	"| page, by keys | keys loaded | keys used | page JS as built | messages, every locale | one locale, Paraglide per-locale build | one locale, grai | grai, no-input messages as strings | grai, no-input messages inlined | grai saves |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|");
// A message without inputs inlined at its call site: its text once, as a literal, and no function.
const withoutInputs = (key) =>
	typeof app.messages[reader][key] === "string" &&
	!/\{[^#/]/.test(app.messages[reader][key]);
const ranked = pages
	.filter((page) => page.keys.length > 0)
	.sort((a, b) => b.keys.length - a.keys.length);
const totals = {
	every: 0,
	perLocale: 0,
	grai: 0,
	strings: 0,
	inlined: 0,
	js: 0,
};
for (const [index, page] of ranked.entries()) {
	const every = await bundled(everyLocale, page.keys);
	const perLocale = await bundled(perLocaleBuild, page.keys, reader);
	const grai = await bundled(join(prototype, `${reader}.js`), page.keys);
	const strings = await bundled(
		join(prototype, `${reader}.strings.js`),
		page.keys,
	);
	totals.strings += strings.brotli;
	const inlinedKeys = page.keys.filter(withoutInputs);
	const inlined = await bundled(
		join(prototype, `${reader}.js`),
		page.keys.filter((key) => !withoutInputs(key)),
		undefined,
		inlinedKeys.map((key) => template(app.messages[reader][key])),
	);
	totals.inlined += inlined.brotli;
	totals.every += every.brotli;
	totals.perLocale += perLocale.brotli;
	totals.grai += grai.brotli;
	totals.js += page.js;
	if (index < 10 || index === ranked.length - 1) {
		const cell = (size) => `${kb(size.brotli)} (${kb(size.raw)})`;
		console.log(
			`| ${index + 1} | ${page.keys.length} | ${page.used} | ${kb(page.js)} | ${cell(every)} | ${cell(perLocale)} | ${cell(grai)} | ${cell(strings)} | ${cell(inlined)} | ${(100 * (1 - grai.brotli / every.brotli)).toFixed(0)}% |`,
		);
	}
}
const less = (value) =>
	`${(100 * (1 - value / totals.every)).toFixed(0)}% less`;
console.log(
	`\n${ranked.length} pages, summed brotli: page JS ${kb(totals.js)} KB; messages every locale ${kb(totals.every)} KB; Paraglide per-locale build ${kb(totals.perLocale)} KB (${less(totals.perLocale)}); grai ${kb(totals.grai)} KB (${less(totals.grai)}); grai with no-input messages as strings ${kb(totals.strings)} KB (${less(totals.strings)}); grai with no-input messages inlined ${kb(totals.inlined)} KB (${less(totals.inlined)}).`,
);
