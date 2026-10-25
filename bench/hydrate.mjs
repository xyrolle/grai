// Browser: the message-heavy page (page.mjs) server-rendered, then loaded and hydrated in Chromium,
// with its messages from Paraglide's client runtime; from grai's client build, its locale's copies
// or every locale's chunks (browser-bundle.mjs); from i18next or use-intl with the locale's whole
// catalog in the bundle; or inlined into the template by the prototype. Each run is a fresh page
// with the whole bundle inline, so nothing but parsing, evaluating and hydrating is timed; runs
// alternate between variants. After hydrating, the page mounts itself again, the client work of a
// locale switch that does not reload.
//   node hydrate.mjs [app...]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { chromium } from "playwright-core";
import { render } from "svelte/server";
import { selectedApps } from "./apps.mjs";
import { browserBundle } from "./browser-bundle.mjs";
import { benchDocument, benchPage } from "./chromium.mjs";
import { graiOutput } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { PAGE_CALLS, pageProps, pageSource, writePage } from "./page.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";

const RUNS = 15;
const THROTTLING = [1, 4];

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
window.bench = { started, evaluated, hydrated, mounted: performance.now() - unmounted, text };
`;

async function variants(app, locale) {
	const grai = join((await graiOutput(app)).outdir, "keys.js");
	const { directory: libraries } = writeLibraryModules(app, locale);
	return {
		Paraglide: { from: join(await paraglideOutput(app), "messages/_index.js") },
		"grai, the locale's copies": { from: grai, grai: { app, locale } },
		"grai, every locale's chunks": { from: grai, grai: { app } },
		"prototype, inlined into the template": {
			from: join(writePrototype(app), `${locale}.js`),
			inline: app.messages[locale],
		},
		i18next: {
			from: join(libraries, `${locale}.i18next.js`),
			translate: true,
			values: (call) => i18nextValues(app, call.key, call.inputs),
		},
		"use-intl": {
			from: join(libraries, `${locale}.use-intl.js`),
			translate: true,
		},
	};
}

async function documentFor(app, locale, file, variant, props) {
	const name = `hydrate-${locale}-${file}`;
	const source = pageSource(app, variant);
	const { default: ServerPage } = await import(
		writePage(app, name, source, "server")
	);
	const { body, head } = await inRequest(app, locale, () =>
		render(ServerPage, { props }),
	);
	const page = writePage(app, name, source, "client");
	const entryFile = page.replace(/\.client\.js$/, ".entry.js");
	writeFileSync(entryFile, entry(page));
	const code = await browserBundle(entryFile, {
		banner: "const started = performance.now();",
		grai: variant.grai,
	});
	const json = JSON.stringify(props).replaceAll("<", "\\u003c");
	const html = benchDocument(locale, {
		head,
		body: `<div id="app">${body}</div><script id="props" type="application/json">${json}</script>`,
		script: code,
	});
	return {
		html,
		bytes: {
			raw: Buffer.byteLength(code),
			brotli: brotliCompressSync(code).length,
		},
	};
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function benchLocale(browser, app, locale) {
	const documents = [];
	for (const [name, variant] of Object.entries(await variants(app, locale))) {
		const props = pageProps(app, variant.values);
		documents.push({
			name,
			...(await documentFor(app, locale, documents.length, variant, props)),
		});
	}
	let expected;
	for (const rate of THROTTLING) {
		const samples = documents.map(() => []);
		for (let run = 0; run < RUNS; run++) {
			for (const [index, document] of documents.entries()) {
				const result = await benchPage(
					browser,
					app,
					locale,
					document.html,
					rate,
				);
				expected ??= result.text;
				if (result.text !== expected)
					throw new Error(
						`${document.name} hydrates other text than Paraglide in ${locale}`,
					);
				samples[index].push(result);
			}
		}
		for (const [index, document] of documents.entries()) {
			const runs = samples[index];
			const cell = (pick) => median(runs.map(pick)).toFixed(1);
			const kb = `${(document.bytes.brotli / 1024).toFixed(1)} (${(document.bytes.raw / 1024).toFixed(0)})`;
			console.log(
				`| ${document.name} | ${locale} | ${rate}× | ${kb} | ${cell((r) => r.started)} | ${cell((r) => r.evaluated - r.started)} | ${cell((r) => r.hydrated - r.evaluated)} | ${cell((r) => r.hydrated)} | ${cell((r) => r.mounted)} |`,
			);
		}
	}
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: a page with ${PAGE_CALLS} message calls in Chromium ${browser.version()} (Paraglide ${paraglideVersion}), median of ${RUNS} loads, ms\n`,
	);
	console.log(
		"| variant | locale | CPU slowdown | JS KB brotli (raw) | script starts | evaluates | hydrates | hydrated at | mounts again |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|");
	for (const locale of [app.baseLocale, otherLocale(app)])
		await benchLocale(browser, app, locale);
}
await browser.close();
