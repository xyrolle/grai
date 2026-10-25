// Browser: what a message call costs in a page, in Chromium: the calls `server` makes
// (render-calls.mjs), bundled into the page's one script as each library ships them: Paraglide's
// output; grai's client build, with the page's locale copies or every locale's chunks
// (browser-bundle.mjs); i18next and use-intl with the locale's catalog. Each page checks its text
// against Paraglide's, then times its calls as `server` times them in Node.
//   node client.mjs [app...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import { browserBundle } from "./browser-bundle.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { benchDocument, benchPage } from "./chromium.mjs";
import { paraglideVersion } from "./paraglide.mjs";
import {
	CALLS,
	callsOf,
	KINDS,
	libraryVariants,
	renderSource,
	TABLE_HEAD,
	tableRow,
	withValues,
} from "./render-calls.mjs";
import { otherLocale } from "./request.mjs";

const here = (file) => new URL(file, import.meta.url).pathname;

/** The page's script: the calls' values built, the calls rendered once for the check, then timed. */
const entry = (render, calls, locale) => `
import { callValues } from ${JSON.stringify(here("call-values.mjs"))};
import { nanosecondsPer } from ${JSON.stringify(here("measure.mjs"))};
import { render } from ${JSON.stringify(render)};
const values = callValues(${JSON.stringify(calls)}, ${JSON.stringify(locale)});
const text = render(values);
window.bench = { text, ns: nanosecondsPer(() => render(values), ${calls.length}) };
`;

/** The libraries' variants, with grai's as its client build ships them. */
async function variants(app, locale) {
	const {
		"grai `m.key()`": grai,
		"grai `m.key(i, { locale })`": forced,
		...others
	} = await libraryVariants(app, locale);
	const copies = { app, locale };
	return {
		...others,
		"grai `m.key()`, the locale's copies": { ...grai, grai: copies },
		"grai `m.key(i, { locale })`, the locale's copies": {
			...forced,
			grai: copies,
		},
		"grai `m.key()`, every locale's chunks": { ...grai, grai: { app } },
	};
}

async function benchLocale(browser, app, locale) {
	const rows = new Map();
	const all = Object.entries(await variants(app, locale));
	for (const kind of KINDS) {
		const calls = sampleCalls(app, CALLS, kind === "page" ? undefined : kind);
		if (calls.length === 0) continue;
		const directory = join(cacheDir, "client", app.id, kind);
		mkdirSync(directory, { recursive: true });
		let expected;
		for (const [index, [name, variant]] of all.entries()) {
			const spec = callsOf(variant, kind);
			if (spec === undefined) continue;
			const render = join(directory, `${index}-${locale}.render.js`);
			writeFileSync(render, renderSource(calls, spec));
			const page = join(directory, `${index}-${locale}.js`);
			writeFileSync(page, entry(render, withValues(app, calls), locale));
			const script = await browserBundle(page, { grai: spec.grai });
			const { text, ns } = await benchPage(
				browser,
				app,
				locale,
				benchDocument(locale, { script }),
			);
			expected ??= text;
			if (text !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale} (${kind})`,
				);
			rows.set(name, { ...rows.get(name), [kind]: ns });
		}
	}
	for (const [name, ns] of rows) console.log(tableRow(name, locale, ns));
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const mix = kindsOf(sampleCalls(app, CALLS));
	console.log(
		`\n### ${app.name}: Paraglide ${paraglideVersion}, Chromium ${browser.version()}, page of ${CALLS} calls ${JSON.stringify(mix)}\n`,
	);
	console.log(TABLE_HEAD);
	for (const locale of [app.baseLocale, otherLocale(app)])
		await benchLocale(browser, app, locale);
}
await browser.close();
