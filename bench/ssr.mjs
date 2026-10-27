// Server render: the message-heavy page (page.mjs) rendered by Svelte inside a request, as an app
// built with Vite renders it (page-app.mjs): its messages from Paraglide, from grai, from i18next
// or use-intl, or inlined into the template by the prototype, each built with its library's own
// plugins, beside the library's server entry. The rendered text is checked against Paraglide's
// before it is timed. The clock is a warm render in a request already open, `render(Page, {
// props })` after a warm-up; compiling, imports, the libraries' setup and the middleware are
// outside it. The inlined page writes each message without a selector into the template, so what
// it saves is what those calls cost; its plurals and selects still call their functions.
//   node ssr.mjs [app...]
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { graiOutput } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { PAGE_CALLS, pageProps, pageText } from "./page.mjs";
import { buildServer, writePageApp } from "./page-app.mjs";
import { paraglideForVite, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const GRAI = "grai";
const INLINED = "prototype, inlined into the template";

async function serverVariants(app, locale) {
	const paraglide = await paraglideForVite(app);
	const { outdir } = await graiOutput(app);
	const { directory: libraries } = writeLibraryModules(app, locale);
	return {
		Paraglide: {
			library: "paraglide",
			server: join(paraglide, "server.js"),
			from: join(paraglide, "messages.js"),
		},
		[GRAI]: {
			library: "grai",
			server: join(outdir, "server.js"),
			from: join(outdir, "keys.js"),
		},
		[INLINED]: {
			library: "prototype",
			from: join(writePrototype(app), `${locale}.js`),
			inline: app.messages[locale],
		},
		i18next: {
			library: "i18next",
			from: join(libraries, `${locale}.i18next.js`),
			translate: true,
			values: (call) => i18nextValues(app, call.key, call.inputs),
		},
		"use-intl": {
			library: "use-intl",
			from: join(libraries, `${locale}.use-intl.js`),
			translate: true,
		},
	};
}

const localesOf = (app) => [app.baseLocale, otherLocale(app)];

for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: Svelte SSR of a page with ${PAGE_CALLS} message calls (Paraglide ${paraglideVersion}, Node ${process.versions.node})\n`,
	);
	console.log("| variant | locale | ms per render | messages' share |");
	console.log("|---|---|---|---|");
	const recorded = [];
	for (const locale of localesOf(app)) {
		const results = [];
		let expected;
		for (const [index, [name, variant]] of Object.entries(
			await serverVariants(app, locale),
		).entries()) {
			const root = writePageApp(app, `ssr-${locale}-${index}`, variant);
			const { render, Page, ...server } = await import(
				await buildServer(app, root, variant)
			);
			const props = pageProps(app, variant.values);
			const html = await inRequest(
				app,
				locale,
				server,
				() => render(Page, { props }).body,
			);
			expected ??= pageText(html);
			if (pageText(html) !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale}`,
				);
			results.push([
				name,
				await inRequest(app, locale, server, () =>
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
