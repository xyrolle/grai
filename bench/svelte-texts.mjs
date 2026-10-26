// Browser: the message-heavy page (page.mjs) built by Vite through grai's own plugins, server-
// rendered, then loaded and hydrated in Chromium in each locale through its import map:
// - grai/vite: every message a call, as a client build has them;
// - grai/svelte: each message without inputs read as its string in the page's locale, the page
//   importing the namespace, then each key by its own path (`#i18n/messages/<key>.js`);
// - strings after the compile: those calls replaced by their strings once Svelte compiled the
//   component, as a bundler transform would (strings-after-compile.mjs);
// - text inlined: those messages' text written into the template, which only a build of every
//   component per locale reaches.
// Messages with inputs stay calls in all four. Runs alternate between variants, each in a fresh
// context; the JS is what the page loads, its message chunks in its own locale.
//   node svelte-texts.mjs [app...]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { chromium } from "playwright-core";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { build } from "vite";
import { selectedApps } from "./apps.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { PAGE_CALLS, pageProps, pageSource } from "./page.mjs";
import { otherLocale } from "./request.mjs";
import { stringsAfterCompile } from "./strings-after-compile.mjs";

const { grai: graiVite } = await import(join(graiSource, "vite.ts"));
const { grai: graiSvelte } = await import(join(graiSource, "svelte.ts"));
const { recompile } = await import(join(graiSource, "compile.ts"));

const RUNS = 15;
const THROTTLING = [1, 4];
const keys = "./out/keys.js";

const entry = (page) => `
import { hydrate, mount, unmount } from "svelte";
import Page from ${JSON.stringify(page)};
const evaluated = performance.now();
const target = document.getElementById("app");
const props = JSON.parse(document.getElementById("props").textContent);
let app = hydrate(Page, { target, props });
const hydrated = performance.now();
const text = target.textContent;
unmount(app);
const unmounted = performance.now();
app = mount(Page, { target, props });
window.bench = { evaluated, hydrated, mounted: performance.now() - unmounted, text };
`;

/** A page's source and its entry, written into the project under `name`. */
function writeEntry(dir, name, source) {
	writeFileSync(join(dir, `${name}.svelte`), source);
	writeFileSync(join(dir, `${name}.js`), entry(`./${name}.svelte`));
	return join(dir, `${name}.js`);
}

/** The page as the server draws it in a locale, its messages from grai's output. */
async function serverBody(dir, name, source, locale, props) {
	const path = join(dir, `${name}.server.js`);
	writeFileSync(path, compile(source, { generate: "server" }).js.code);
	const { setLocale } = await import(join(dir, "out", "runtime.js"));
	setLocale(locale);
	return render((await import(path)).default, { props }).body;
}

/** A client build of an entry: its files by name, and what the page loads in a locale. */
async function clientBuild(dir, input, plugins) {
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins,
		build: { write: false, rolldownOptions: { input: { entry: input } } },
	});
	const files = (Array.isArray(output) ? output : [output]).flatMap(
		(result) => result.output,
	);
	const sources = new Map(
		files.map((file) => [
			file.fileName,
			file.type === "chunk" ? file.code : String(file.source),
		]),
	);
	const chunks = new Map(files.map((file) => [file.fileName, file]));
	const main = files.find((file) => file.type === "chunk" && file.isEntry);
	/** The files a page in `locale` loads, its message chunks taken from its locale's copies. */
	const loaded = (locale) => {
		const seen = new Set();
		const visit = (fileName) => {
			if (seen.has(fileName)) return;
			seen.add(fileName);
			for (const imported of chunks.get(fileName)?.imports ?? [])
				visit(imported);
		};
		visit(main.fileName);
		return [...seen].map((fileName) =>
			fileName.startsWith("assets/grai/")
				? fileName.replace("assets/grai/", `assets/grai-${locale}/`)
				: fileName,
		);
	};
	return { sources, entry: main.fileName, loaded };
}

function documentOf(locale, body, props, built) {
	const json = JSON.stringify(props).replaceAll("<", "\\u003c");
	const files = built.loaded(locale);
	const bytes = (pick) =>
		files.reduce((sum, file) => sum + pick(built.sources.get(file) ?? ""), 0);
	return {
		html: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><script type="importmap">{"imports":{"/assets/grai/":"/assets/grai-${locale}/"}}</script></head><body><div id="app">${body}</div><script id="props" type="application/json">${json}</script><script type="module" src="/${built.entry}"></script></body></html>`,
		sources: built.sources,
		raw: bytes((code) => Buffer.byteLength(code)),
		brotli: bytes((code) => brotliCompressSync(code).length),
	};
}

async function load(browser, document, rate) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate });
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	await page.route("https://bench.test/**", (route) => {
		const path = new URL(route.request().url()).pathname.slice(1);
		return path === "page"
			? route.fulfill({ contentType: "text/html", body: document.html })
			: route.fulfill({
					contentType: "text/javascript",
					body: document.sources.get(path) ?? "",
				});
	});
	await page.goto("https://bench.test/page");
	const result = await page
		.waitForFunction(() => window.bench)
		.then((handle) => handle.jsonValue());
	await context.close();
	if (errors.length > 0) throw new Error(errors.join("; "));
	return result;
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function benchLocale(browser, app, dir, compiledKeys, locale) {
	const props = pageProps(app);
	const calls = pageSource(app, { from: keys });
	const isText = (key) => compiledKeys.get(key)?.kind === "text";
	const texts = Object.fromEntries(
		Object.entries(app.messages[locale]).filter(([key]) => isText(key)),
	);
	const index = app.locales.indexOf(locale);
	const strings = new Map(
		[...compiledKeys]
			.filter(([key]) => isText(key))
			.map(([key, compiled]) => [key, compiled.variants[index]]),
	);
	const inlined = pageSource(app, { from: keys, inline: texts });
	const body = await serverBody(dir, "Calls", calls, locale, props);
	const callsEntry = writeEntry(dir, "Calls", calls);
	const perKeyEntry = writeEntry(
		dir,
		"PerKey",
		pageSource(app, { from: (key) => `#i18n/messages/${key}.js` }),
	);
	const inlinedEntry = writeEntry(dir, `Inlined-${locale}`, inlined);
	const variants = {
		"grai/vite: calls": await clientBuild(dir, callsEntry, [
			graiVite({ localeChunks: true }),
			svelte(),
		]),
		"grai/svelte: strings": await clientBuild(dir, callsEntry, [
			graiSvelte({ localeChunks: true }),
			svelte(),
		]),
		"grai/svelte: strings, per-key imports": await clientBuild(
			dir,
			perKeyEntry,
			[graiSvelte({ localeChunks: true }), svelte()],
		),
		"strings after the compile": await clientBuild(dir, callsEntry, [
			graiVite({ localeChunks: true }),
			svelte(),
			stringsAfterCompile(strings),
		]),
		"text inlined": await clientBuild(dir, inlinedEntry, [
			graiVite({ localeChunks: true }),
			svelte(),
		]),
	};
	const inlinedBody = await serverBody(
		dir,
		`Inlined-${locale}`,
		inlined,
		locale,
		props,
	);
	const documents = Object.entries(variants).map(([name, built]) => ({
		name,
		...documentOf(
			locale,
			name === "text inlined" ? inlinedBody : body,
			props,
			built,
		),
	}));
	let expected;
	for (const rate of THROTTLING) {
		const samples = documents.map(() => []);
		for (let run = 0; run < RUNS; run++) {
			for (const [index, document] of documents.entries()) {
				const result = await load(browser, document, rate);
				// Svelte trims the spaces at the edges of an element's text, so the words are compared.
				const text = result.text.replace(/\s+/g, "");
				expected ??= text;
				if (text !== expected)
					throw new Error(`${document.name} hydrates other text in ${locale}`);
				samples[index].push(result);
			}
		}
		for (const [index, document] of documents.entries()) {
			const cell = (pick) => median(samples[index].map(pick)).toFixed(1);
			const kb = `${(document.brotli / 1024).toFixed(1)} (${(document.raw / 1024).toFixed(0)})`;
			console.log(
				`| ${document.name} | ${locale} | ${rate}× | ${kb} | ${cell((r) => r.evaluated)} | ${cell((r) => r.hydrated - r.evaluated)} | ${cell((r) => r.hydrated)} | ${cell((r) => r.mounted)} |`,
			);
		}
	}
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const config = writeGraiProject(app, "svelte-texts");
	// A key's own path maps to keys.js, as an app maps its message paths in package.json.
	writeFileSync(
		join(dirname(config), "package.json"),
		JSON.stringify({ imports: { "#i18n/messages/*": "./out/keys.js" } }),
	);
	const { build: compiled } = await recompile(config, undefined);
	if (compiled === undefined)
		throw new Error(`grai cannot compile ${app.name}`);
	console.log(
		`\n### ${app.name}: a page with ${PAGE_CALLS} message calls in Chromium ${browser.version()}, median of ${RUNS} loads, ms\n`,
	);
	console.log(
		"| text messages as | locale | CPU slowdown | JS KB brotli (raw) | evaluated at | hydrates | hydrated at | mounts again |",
	);
	console.log("|---|---|---|---|---|---|---|---|");
	for (const locale of [app.baseLocale, otherLocale(app)])
		await benchLocale(
			browser,
			app,
			dirname(config),
			compiled.compilation.keys,
			locale,
		);
}
await browser.close();
