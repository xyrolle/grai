// Server render: the message-heavy page (page.mjs) rendered by Svelte inside a request, with its
// messages from Paraglide, from grai's output as its Vite plugin builds it for a server, from
// i18next or use-intl, or inlined into the template by the prototype. What inlining saves is what
// messages cost the render.
//   node ssr.mjs [app...]
import { join } from "node:path";
import { render } from "svelte/server";
import { selectedApps } from "./apps.mjs";
import { graiServerBuild } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import {
	PAGE_CALLS,
	pageProps,
	pageSource,
	pageText,
	writePage,
} from "./page.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const INLINED = "prototype, inlined into the template";

async function serverVariants(app, locale) {
	const { directory: libraries } = writeLibraryModules(app, locale);
	return {
		Paraglide: { from: join(await paraglideOutput(app), "messages.js") },
		grai: { from: join(await graiServerBuild(app), "keys.js") },
		[INLINED]: {
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

for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: Svelte SSR of a page with ${PAGE_CALLS} message calls (Paraglide ${paraglideVersion}, Node ${process.versions.node})\n`,
	);
	console.log("| variant | locale | ms per render | messages' share |");
	console.log("|---|---|---|---|");
	const recorded = [];
	for (const locale of [app.baseLocale, otherLocale(app)]) {
		const results = [];
		let expected;
		for (const [name, variant] of Object.entries(
			await serverVariants(app, locale),
		)) {
			const file = `ssr-${locale}-${results.length}`;
			const props = pageProps(app, variant.values);
			const { default: Page } = await import(
				writePage(app, file, pageSource(app, variant), "server")
			);
			const html = await inRequest(
				app,
				locale,
				() => render(Page, { props }).body,
			);
			expected ??= pageText(html);
			if (pageText(html) !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale}`,
				);
			results.push([
				name,
				await inRequest(app, locale, () =>
					nanosecondsPer(() => render(Page, { props }).body),
				),
			]);
		}
		const inlined = results.find(([name]) => name === INLINED)[1];
		for (const [name, ns] of results) {
			console.log(
				`| ${name} | ${locale} | ${formatNs(ns / 1e6)} | ${((100 * (ns - inlined)) / ns).toFixed(0)}% |`,
			);
			recorded.push({ variant: name, locale, ns });
		}
	}
	recordResults(`ssr-${app.id}`, recorded, {
		app: app.name,
		calls: PAGE_CALLS,
	});
}
