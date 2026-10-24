// Server render: the message-heavy page (page.mjs) rendered by Svelte inside a request, with its
// messages from Paraglide, from grai's server entry, from a per-locale module, or inlined into the
// template. What inlining saves is what messages cost the render.
//   node ssr.mjs [app...]
import { join } from "node:path";
import { render } from "svelte/server";
import { selectedApps } from "./apps.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import {
	PAGE_CALLS,
	pageProps,
	pageSource,
	visibleText,
	writePage,
} from "./page.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";

async function serverVariants(app, locale) {
	const paraglide = join(await paraglideOutput(app), "messages.js");
	const prototype = writePrototype(app);
	const localeModule = join(prototype, `${locale}.js`);
	return {
		Paraglide: { from: paraglide },
		"grai, one array index, locale from ALS": {
			from: join(prototype, "server.js"),
		},
		"grai, per-locale module": { from: localeModule },
		"inlined into the template": {
			from: localeModule,
			inline: app.messages[locale],
		},
	};
}

for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: Svelte SSR of a page with ${PAGE_CALLS} message calls (Paraglide ${paraglideVersion}, Node ${process.versions.node})\n`,
	);
	console.log("| variant | locale | ms per render | messages' share |");
	console.log("|---|---|---|---|");
	const props = pageProps(app);
	for (const locale of [app.baseLocale, otherLocale(app)]) {
		const results = [];
		let expected;
		for (const [name, variant] of Object.entries(
			await serverVariants(app, locale),
		)) {
			const file = `ssr-${locale}-${results.length}`;
			const { default: Page } = await import(
				writePage(app, file, pageSource(app, variant), "server")
			);
			const html = await inRequest(
				app,
				locale,
				() => render(Page, { props }).body,
			);
			expected ??= visibleText(html);
			if (visibleText(html) !== expected)
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
		const inlined = results.at(-1)[1];
		for (const [name, ns] of results) {
			console.log(
				`| ${name} | ${locale} | ${formatNs(ns / 1e6)} | ${((100 * (ns - inlined)) / ns).toFixed(0)}% |`,
			);
		}
	}
}
