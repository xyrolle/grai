// Browser: the message-heavy page (page.mjs) built as a Svelte app with Vite (page-app.mjs), each
// library's build with its own plugins, server-rendered by its server build, then loaded and
// hydrated in Chromium. Its messages come from Paraglide; from grai, the page pointed at its
// locale's copies of the message chunks, or loading the chunks with every locale; from i18next or
// use-intl with the page's own keys, as both advise, or with the locale's whole catalog; or inlined
// into the template by the prototype.
//
// The page is served as the build wrote it, with the server's render drawn into it, and loads its
// files one by one; its JS is the sum of the scripts it loads, each compressed on its own, and of
// those its index.html holds inline. The bench's own script goes in the page beside them, outside
// that sum: it imports what the page's entry gives, then times `hydrate`, from when every module
// has been evaluated until it returns, with Svelte's recovery off, so that a page that fails to
// hydrate fails the bench rather than mounting anew. The page then mounts itself again, the client
// work of a locale switch that does not reload. Both texts are checked against the server's. Runs
// alternate between variants, each in a fresh context.
//   node hydrate.mjs [app...]
import { join } from "node:path";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { benchPage } from "./chromium.mjs";
import { graiOutput } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { median } from "./medians.mjs";
import { PAGE_CALLS, pageKeys, pageProps, pageText } from "./page.mjs";
import {
	APP_HEAD,
	APP_HTML,
	buildClient,
	buildServer,
	writePageApp,
} from "./page-app.mjs";
import { paraglideForVite, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const RUNS = 15;
const THROTTLING = [1, 4];
const GRAI = "grai, the locale's copies";

/** The bench's script: what the page's entry gives, timed as the page hydrates and mounts again. */
const harness = (entry) => `
import { hydrate, mount, unmount, Page } from ${JSON.stringify(entry)};
const evaluated = performance.now();
const loaded = Math.max(...performance.getEntriesByType("resource").filter((resource) => resource.name.endsWith(".js")).map((resource) => resource.responseEnd));
const target = document.getElementById("app");
const props = JSON.parse(document.getElementById("props").textContent);
let app = hydrate(Page, { target, props, recover: false });
const hydrated = performance.now();
const text = target.textContent;
unmount(app);
const unmounted = performance.now();
app = mount(Page, { target, props });
const mounted = performance.now() - unmounted;
window.bench = { loaded, evaluated, hydrated, mounted, text, remounted: target.textContent };
`;

async function variants(app, locale) {
	const paraglide = await paraglideForVite(app);
	const { outdir } = await graiOutput(app);
	const translators = (options) =>
		writeLibraryModules(app, locale, options).directory;
	const page = translators({ keys: pageKeys(app), set: "page" });
	const whole = translators();
	const fromParaglide = {
		library: "paraglide",
		server: join(paraglide, "server.js"),
		from: join(paraglide, "messages.js"),
	};
	const fromGrai = {
		library: "grai",
		server: join(outdir, "server.js"),
		from: join(outdir, "keys.js"),
	};
	const i18next = (directory) => ({
		library: "i18next",
		from: join(directory, `${locale}.i18next.js`),
		translate: true,
		values: (call) => i18nextValues(app, call.key, call.inputs),
	});
	const intl = (directory) => ({
		library: "use-intl",
		from: join(directory, `${locale}.use-intl.js`),
		translate: true,
	});
	return {
		Paraglide: fromParaglide,
		[GRAI]: { ...fromGrai, localeChunks: true },
		"grai, every locale's chunks": fromGrai,
		"prototype, inlined into the template": {
			library: "prototype",
			from: join(writePrototype(app), `${locale}.js`),
			inline: app.messages[locale],
		},
		i18next: i18next(page),
		"use-intl": intl(page),
		"i18next, the locale's whole catalog": i18next(whole),
		"use-intl, the locale's whole catalog": intl(whole),
	};
}

/**
 * A variant's page in a locale: the app built, the page rendered by its server build inside a
 * request and drawn into the built index.html with the request's locale, its props beside it,
 * and the bench's script after them. With the text the server drew and the scripts the page
 * holds inline.
 */
async function documentFor(app, locale, index, variant) {
	const root = writePageApp(app, `hydrate-${locale}-${index}`, variant);
	const props = pageProps(app, variant.values);
	const { render, Page, ...server } = await import(
		await buildServer(app, root, variant)
	);
	// Svelte renders when the output is first read, so both are read inside the request.
	const { head, body } = await inRequest(app, locale, server, () => {
		const output = render(Page, { props });
		return { head: output.head, body: output.body };
	});
	const client = await buildClient(app, root, variant);
	const json = JSON.stringify(props).replaceAll("<", "\\u003c");
	const bench = harness(client.entry).replaceAll("</script", "<\\/script");
	const html = client.html
		.replace(`lang="${app.baseLocale}"`, `lang="${locale}"`)
		.replace(APP_HEAD, () => head)
		.replace(APP_HTML, () => body)
		.replace(
			"</body>",
			() =>
				`<script id="props" type="application/json">${json}</script><script type="module">${bench}</script></body>`,
		);
	return {
		page: { html, directory: client.directory, inline: client.inline },
		text: pageText(body),
	};
}

/** Fails a load whose page hydrated or mounted again to other text than the server drew. */
function checkTexts(name, locale, document, { bench }) {
	if (bench.text !== document.text)
		throw new Error(
			`${name} hydrates other text than its server drew in ${locale}`,
		);
	if (bench.remounted !== document.text)
		throw new Error(
			`${name} mounts again to other text than its server drew in ${locale}`,
		);
}

/** The JS a page loads: each script it asked for and each it holds inline, compressed on its own. */
const bytesOf = (scripts) => ({
	raw: scripts.reduce((sum, script) => sum + script.raw, 0),
	brotli: scripts.reduce((sum, script) => sum + script.brotli, 0),
});

/** Benches the page in a locale, and returns each variant's bytes and times, as the run measured them. */
async function benchLocale(browser, app, locale) {
	const recorded = [];
	const documents = [];
	for (const [index, [name, variant]] of Object.entries(
		await variants(app, locale),
	).entries())
		documents.push({
			name,
			...(await documentFor(app, locale, index, variant)),
		});
	if (new Set(documents.map(({ text }) => text)).size !== 1)
		throw new Error(`The variants' servers drew other texts in ${locale}`);
	for (const rate of THROTTLING) {
		const samples = documents.map(() => []);
		for (let run = 0; run < RUNS; run++) {
			for (const [index, document] of documents.entries()) {
				const load = await benchPage(browser, app, locale, document.page, rate);
				checkTexts(document.name, locale, document, load);
				document.scripts ??= load.scripts;
				samples[index].push(load.bench);
			}
		}
		for (const [index, document] of documents.entries()) {
			const runs = samples[index];
			const ms = (pick) => median(runs.map(pick));
			const bytes = bytesOf(document.scripts);
			const row = {
				variant: document.name,
				locale,
				slowdown: rate,
				bytes,
				resources: document.scripts,
				ms: {
					starts: ms((r) => r.loaded),
					evaluates: ms((r) => r.evaluated - r.loaded),
					hydrates: ms((r) => r.hydrated - r.evaluated),
					hydratedAt: ms((r) => r.hydrated),
					mounts: ms((r) => r.mounted),
				},
			};
			recorded.push(row);
			const cell = (value) => value.toFixed(1);
			console.log(
				`| ${document.name} | ${locale} | ${rate}× | ${(bytes.brotli / 1024).toFixed(1)} (${(bytes.raw / 1024).toFixed(0)}) | ${cell(row.ms.starts)} | ${cell(row.ms.evaluates)} | ${cell(row.ms.hydrates)} | ${cell(row.ms.hydratedAt)} | ${cell(row.ms.mounts)} |`,
			);
		}
	}
	return recorded;
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: a page with ${PAGE_CALLS} message calls of ${pageKeys(app).length} keys in Chromium ${browser.version()} (Paraglide ${paraglideVersion}), median of ${RUNS} loads, ms\n`,
	);
	console.log(
		"| variant | locale | CPU slowdown | JS KB brotli (raw) | scripts loaded | evaluated | hydrates | hydrated at | mounts again |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|");
	const recorded = [];
	for (const locale of [app.baseLocale, otherLocale(app)])
		recorded.push(...(await benchLocale(browser, app, locale)));
	recordResults(`hydrate-${app.id}`, recorded, {
		app: app.name,
		calls: PAGE_CALLS,
		keys: pageKeys(app).length,
		runs: RUNS,
		chromium: browser.version(),
	});
}
await browser.close();
