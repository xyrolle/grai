// Browser: what a message call costs in a page, in Chromium: the calls `server` makes
// (render-calls.mjs), in a page each library's production build makes with its own plugins
// (production.mjs): Paraglide's output; grai's client build, the page pointed at its locale's
// copies or loading every locale's chunks; i18next and use-intl with the locale's catalog. Each
// page checks its text against Paraglide's, then times its calls as `server` times them in Node.
//   node client.mjs [app...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { benchPage } from "./chromium.mjs";
import { paraglideVersion } from "./paraglide.mjs";
import { clientBuild, PAGE_ENTRY, pluginsOf } from "./production.mjs";
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

/** The libraries' variants, with grai's page pointed at its locale's copies or at every locale's chunks. */
async function variants(app, locale) {
	const {
		"grai `m.key()`": grai,
		"grai `m.key(i, { locale })`": forced,
		...others
	} = await libraryVariants(app, locale);
	return {
		...others,
		"grai `m.key()`, the locale's copies": { ...grai, localeChunks: true },
		"grai `m.key(i, { locale })`, the locale's copies": {
			...forced,
			localeChunks: true,
		},
		"grai `m.key()`, every locale's chunks": grai,
	};
}

/** Writes the page of a variant's calls and builds it as its library's client build does. */
async function pageOf(app, root, render, entry, spec) {
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "render.js"), render);
	writeFileSync(join(root, PAGE_ENTRY), entry);
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><html lang="${app.baseLocale}"><head><meta charset="utf-8"></head><body><script type="module" src="./${PAGE_ENTRY}"></script></body></html>\n`,
	);
	const directory = join(root, "dist");
	const { html } = await clientBuild(
		root,
		directory,
		await pluginsOf(spec.library, app, {
			localeChunks: spec.localeChunks === true,
		}),
	);
	return { html, directory };
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
			const { html, directory: built } = await pageOf(
				app,
				join(directory, `${index}-${locale}`),
				renderSource(calls, spec),
				entry("./render.js", withValues(app, calls), locale),
				spec,
			);
			const {
				bench: { text, ns },
			} = await benchPage(browser, app, locale, {
				html: html.replace(`lang="${app.baseLocale}"`, `lang="${locale}"`),
				directory: built,
			});
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
