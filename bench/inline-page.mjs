// What inlining messages gains in the browser, on the message-heavy page (page.mjs): what one call
// costs, and the page's JS, evaluation and hydration, with the page's messages from
// (inline-variants.mjs):
// - today's per-locale copy of its message chunk;
// - that copy collapsed to the locale's variants;
// - bare variants, without the check of a forced locale;
// - calls inlined at their call sites after Svelte compiled the page;
// - text inlined into the template before Svelte compiles it, the one variant Svelte sees as static.
// Each load is a fresh page with the whole bundle inline, and runs alternate between variants.
//   node inline-page.mjs [app...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { chromium } from "playwright-core";
import { rolldown } from "rolldown";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { callsEntry, callsModule } from "./inline-calls.mjs";
import {
	bareCopy,
	collapsedCopy,
	compiledApp,
	inlineCalls,
	todayCopy,
} from "./inline-variants.mjs";
import {
	PAGE_CALLS,
	pageProps,
	pageSource,
	SAMPLED_CALLS,
	writePage,
} from "./page.mjs";
import { otherLocale } from "./request.mjs";

const RUNS = 15;
const THROTTLING = [1, 4];

const hydrateEntry = (page) => `
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
const mounted = performance.now() - unmounted;
window.bench = { started, evaluated, hydrated, mounted, text: [text, target.textContent] };
`;

async function bundle(entry) {
	const build = await rolldown({
		input: "entry",
		platform: "browser",
		resolve: { conditionNames: ["production", "browser", "import", "default"] },
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? entry : null),
			},
		],
		logLevel: "silent",
	});
	const { output } = await build.generate({
		format: "esm",
		minify: true,
		banner: "const started = performance.now();",
	});
	await build.close();
	return output[0].code;
}

/**
 * Each variant's page and calls modules for one locale, written to `directory`. The template
 * variant has no calls module: its text is no call.
 */
function variants(app, build, locale, directory) {
	const calls = sampleCalls(app, SAMPLED_CALLS);
	const keys = [...new Set(calls.map((call) => call.key))];
	const alias = new Map(keys.map((key, index) => [key, `k${index}`]));
	const keyOf = new Map(keys.map((key, index) => [`k${index}`, key]));
	const write = (name, code) => {
		const path = join(directory, `${locale}-${name}.js`);
		writeFileSync(path, code);
		return path;
	};
	const client = (from) =>
		compile(pageSource(app, { from }), {
			generate: "client",
			filename: "Page.svelte",
		}).js.code;
	const from = (name, copy) => {
		const messages = write(name, copy(build, keys, locale));
		return {
			messages,
			page: write(`${name}-page`, client(messages)),
			calls: write(`${name}-calls`, callsModule(calls, alias, messages)),
		};
	};
	const today = from("today", todayCopy);
	const inlined = (name, module) =>
		write(name, inlineCalls(build, module, keyOf, locale));
	return {
		"today's per-locale copy": today,
		"copy collapsed to the locale's variants": from("collapsed", collapsedCopy),
		"bare variants, no forced-locale check": from("bare", bareCopy),
		"inlined at the call site": {
			page: inlined("inlined-page", client(today.messages)),
			calls: inlined(
				"inlined-calls",
				callsModule(calls, alias, today.messages),
			),
		},
		"text inlined into the template": {
			page: writePage(
				app,
				`inline-${locale}-template`,
				pageSource(app, {
					from: today.messages,
					inline: app.messages[locale],
				}),
				"client",
			),
			template: true,
		},
	};
}

/** Each variant's documents for one locale: the hydrated page, and the page that times calls. */
async function documents(app, build, locale) {
	const keysFile = join(build.config.outdir, "keys.js");
	const runtime = await import(join(build.config.outdir, "runtime.js"));
	runtime.setLocale(locale, { reload: false });
	const serverPage = async (name, inline) => {
		const source = pageSource(app, { from: keysFile, inline });
		return (await import(writePage(app, name, source, "server"))).default;
	};
	const plain = await serverPage(`inline-${locale}-server`);
	const template = await serverPage(
		`inline-${locale}-template-server`,
		app.messages[locale],
	);
	const props = pageProps(app);
	const json = JSON.stringify(props).replaceAll("<", "\\u003c");
	const html = (body, head, script) =>
		`<!doctype html><html lang="${locale}"><head><meta charset="utf-8">${head}</head><body><div id="app">${body}</div><script id="props" type="application/json">${json}</script><script type="module">${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
	const directory = join(build.config.root, "variants");
	mkdirSync(directory, { recursive: true });
	const result = [];
	for (const [name, variant] of Object.entries(
		variants(app, build, locale, directory),
	)) {
		const { body, head } = render(variant.template ? template : plain, {
			props,
		});
		const code = await bundle(hydrateEntry(variant.page));
		result.push({
			name,
			page: html(body, head, code),
			calls:
				variant.calls &&
				html("", "", await bundle(callsEntry(variant.calls, SAMPLED_CALLS))),
			brotli: brotliCompressSync(code).length,
			raw: Buffer.byteLength(code),
		});
	}
	return result;
}

async function load(browser, html, rate) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate });
	await page.route("https://bench.test/**", (route) =>
		route.fulfill({ contentType: "text/html", body: html }),
	);
	await page.goto("https://bench.test/page");
	const result = await page
		.waitForFunction(() => window.bench, undefined, { timeout: 120_000 })
		.then((handle) => handle.jsonValue());
	await context.close();
	return result;
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Prints the locale's rows of the page table, and returns its line of call costs. */
async function benchLocale(browser, app, build, locale) {
	const built = await documents(app, build, locale);
	const perCall = [];
	for (const document of built) {
		if (document.calls === undefined) continue;
		const { ns } = await load(browser, document.calls, 1);
		perCall.push(`${document.name} ${ns.toFixed(2)} ns`);
	}
	let expected;
	for (const rate of THROTTLING) {
		const samples = built.map(() => []);
		for (let run = 0; run < RUNS; run++) {
			for (const [index, document] of built.entries()) {
				const result = await load(browser, document.page, rate);
				// What the server drew and hydration kept, then what the client drew itself.
				const text = result.text.join("\n");
				expected ??= text;
				if (text !== expected)
					throw new Error(`${document.name} hydrates other text in ${locale}`);
				samples[index].push(result);
			}
		}
		for (const [index, document] of built.entries()) {
			const cell = (pick) => median(samples[index].map(pick)).toFixed(1);
			console.log(
				`| ${document.name} | ${locale} | ${rate}× | ${(document.brotli / 1024).toFixed(1)} (${(document.raw / 1024).toFixed(0)}) | ${cell((r) => r.started)} | ${cell((r) => r.evaluated - r.started)} | ${cell((r) => r.hydrated - r.evaluated)} | ${cell((r) => r.hydrated)} | ${cell((r) => r.mounted)} |`,
			);
		}
	}
	return `${locale}, one call: ${perCall.join("; ")}`;
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const build = await compiledApp(app);
	console.log(
		`\n### ${app.name}: a page of ${PAGE_CALLS} message calls in Chromium ${browser.version()}, median of ${RUNS} loads, ms\n`,
	);
	console.log(
		"| messages | locale | CPU slowdown | JS KB brotli (raw) | script starts | evaluates | hydrates | hydrated at | mounts again |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|");
	const perCall = [];
	for (const locale of [app.baseLocale, otherLocale(app)])
		perCall.push(await benchLocale(browser, app, build, locale));
	console.log(`\nMedian of 21 rounds in Chromium:\n${perCall.join("\n")}`);
}
await browser.close();
