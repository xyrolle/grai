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
// work of a locale switch that does not reload. Both texts are checked against the server's.
//
// Each variant loads in a browser of its own, once a round, in an order that rotates from round to
// round (rounds.mjs), each load in a fresh context; its figure is the median of its rounds, every
// load kept, with each round's ratio to grai's.
//   ROUNDS=16 node hydrate.mjs [app...]
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
import {
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

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

const pathsOf = (scripts) => scripts.map(({ path }) => path).join("\n");

/** The JS a page loads: each script it asked for and each it holds inline, compressed on its own. */
const bytesOf = (scripts) => ({
	raw: scripts.reduce((sum, script) => sum + script.raw, 0),
	brotli: scripts.reduce((sum, script) => sum + script.brotli, 0),
});

/** Each variant's page in each locale, by locale and then by variant, every server's text checked alike. */
async function documentsOf(app, locales) {
	const documents = new Map();
	for (const locale of locales) {
		const inLocale = new Map();
		for (const [index, [name, variant]] of Object.entries(
			await variants(app, locale),
		).entries())
			inLocale.set(name, await documentFor(app, locale, index, variant));
		const drawn = new Set([...inLocale.values()].map(({ text }) => text));
		if (drawn.size !== 1)
			throw new Error(`The variants' servers drew other texts in ${locale}`);
		documents.set(locale, inLocale);
	}
	return documents;
}

/** Loads each variant's pages, in every locale and at every CPU slowdown, once a round. */
async function bench(app) {
	const locales = [app.baseLocale, otherLocale(app)];
	const documents = await documentsOf(app, locales);
	const names = [...documents.get(app.baseLocale).keys()];
	let chromiumVersion;
	const kept = await inRounds(
		names,
		roundCount(names.length, 2),
		async (name) => {
			const browser = await chromium.launch();
			chromiumVersion = browser.version();
			try {
				const loads = {};
				for (const locale of locales)
					for (const rate of THROTTLING) {
						const document = documents.get(locale).get(name);
						const load = await benchPage(
							browser,
							app,
							locale,
							document.page,
							rate,
						);
						checkTexts(name, locale, document, load);
						loads[`${locale}-${rate}`] = load;
					}
				return loads;
			} finally {
				await browser.close();
			}
		},
	);
	return { locales, names, kept, chromium: chromiumVersion };
}

function report(app, { locales, names, kept, chromium }) {
	console.log(
		`\n### ${app.name}: a page with ${PAGE_CALLS} message calls of ${pageKeys(app).length} keys in Chromium ${chromium} (Paraglide ${paraglideVersion}), medians of ${kept.length} rounds at a load of ${kept.map(({ load }) => load.toFixed(0)).join(", ")}, ms\n`,
	);
	console.log(
		"| variant | locale | CPU slowdown | JS KB brotli (raw) | scripts loaded | evaluated | hydrates | hydrated at | mounts again | hydrates, × grai's (interval) |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|---|");
	const recorded = [];
	for (const locale of locales)
		for (const rate of THROTTLING)
			for (const name of names) {
				const cell = `${locale}-${rate}`;
				const loads = kept.map(({ measured }) => measured.get(name)[cell]);
				const [first] = loads;
				if (
					loads.some(
						({ scripts }) => pathsOf(scripts) !== pathsOf(first.scripts),
					)
				)
					throw new Error(
						`${name} loaded other scripts from one load to the next in ${locale}`,
					);
				const resources = first.scripts;
				const bytes = bytesOf(resources);
				const byRound = (variant, figure) =>
					kept.map(({ measured }) => figure(measured.get(variant)[cell].bench));
				const hydrates = (bench) => bench.hydrated - bench.evaluated;
				const ms = (figure) => median(byRound(name, figure));
				const row = {
					variant: name,
					locale,
					slowdown: rate,
					bytes,
					resources,
					ms: {
						starts: ms((bench) => bench.loaded),
						evaluates: ms((bench) => bench.evaluated - bench.loaded),
						hydrates: ms(hydrates),
						hydratedAt: ms((bench) => bench.hydrated),
						mounts: ms((bench) => bench.mounted),
					},
					against: GRAI,
					ratio: {
						hydrates: pairedRatio(
							byRound(name, hydrates),
							byRound(GRAI, hydrates),
						),
					},
					loads: loads.map(
						({ bench: { text, remounted, ...timing } }) => timing,
					),
				};
				recorded.push(row);
				const cellText = (value) => value.toFixed(1);
				console.log(
					`| ${name} | ${locale} | ${rate}× | ${(bytes.brotli / 1024).toFixed(1)} (${(bytes.raw / 1024).toFixed(0)}) | ${cellText(row.ms.starts)} | ${cellText(row.ms.evaluates)} | ${cellText(row.ms.hydrates)} | ${cellText(row.ms.hydratedAt)} | ${cellText(row.ms.mounts)} | ${ratioText(row.ratio.hydrates)} |`,
				);
			}
	recordResults(`hydrate-${app.id}`, recorded, {
		app: app.name,
		calls: PAGE_CALLS,
		keys: pageKeys(app).length,
		runs: kept.length,
		chromium,
		rounds: roundsRecord(kept),
	});
}

for (const app of selectedApps()) report(app, await bench(app));
