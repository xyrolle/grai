// Server render: the message-heavy page (page.mjs) rendered by Svelte inside a request, as an app
// built with Vite renders it (page-app.mjs): its messages from Paraglide, from grai, from i18next
// or use-intl, or inlined into the template by the prototype, each built with its library's own
// plugins, beside the library's server entry. The rendered text is checked against Paraglide's
// before it is timed. The clock is a warm render in a request already open, `render(Page, {
// props })` after a warm-up; compiling, imports, the libraries' setup and the middleware are
// outside it. The inlined page writes each message without a selector into the template, so what
// it saves is what those calls cost; its plurals and selects still call their functions.
//
// Each variant renders in a process of its own, once a round, in an order that rotates from round
// to round (rounds.mjs). Its figure is the median of its rounds, each the median of SAMPLES
// renders; every sample is kept, with each round's ratio to grai's.
//   ROUNDS=10 node ssr.mjs [app...]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiOutput } from "./grai.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { formatNs, nanosecondSamples } from "./measure.mjs";
import { median } from "./medians.mjs";
import { PAGE_CALLS, pageProps, pageText } from "./page.mjs";
import { buildServer, writePageApp } from "./page-app.mjs";
import { paraglideForVite, paraglideVersion } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";
import {
	inProcess,
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

/** The timed renders a variant takes in each locale, each round. */
const SAMPLES = 11;
const self = new URL(import.meta.url).pathname;
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

/**
 * Builds each variant's page as an app's server build has it, in each locale, with the props it
 * renders. Returns, by name, each locale's built server entry and props file.
 */
async function buildVariants(app) {
	const plan = {};
	for (const locale of localesOf(app))
		for (const [index, [name, variant]] of Object.entries(
			await serverVariants(app, locale),
		).entries()) {
			const root = writePageApp(app, `ssr-${locale}-${index}`, variant);
			const props = join(root, "props.json");
			writeFileSync(props, JSON.stringify(pageProps(app, variant.values)));
			plan[name] ??= {};
			plan[name][locale] = {
				server: await buildServer(app, root, variant),
				props,
			};
		}
	return plan;
}

/** Runs in the child: the variant's page rendered in each locale, its text's hash and its samples. */
async function child(planFile, name) {
	const plan = JSON.parse(readFileSync(planFile, "utf8"));
	const [app] = selectedApps([plan.app]);
	const measured = {};
	for (const [locale, built] of Object.entries(plan.variants[name])) {
		const { render, Page, ...server } = await import(built.server);
		const props = JSON.parse(readFileSync(built.props, "utf8"));
		const html = await inRequest(
			app,
			locale,
			server,
			() => render(Page, { props }).body,
		);
		const samples = await inRequest(app, locale, server, () =>
			nanosecondSamples(() => render(Page, { props }).body, 1, {
				samples: SAMPLES,
			}),
		);
		measured[locale] = {
			text: createHash("sha256").update(pageText(html)).digest("hex"),
			samples,
		};
	}
	console.log(JSON.stringify(measured));
}

/** Fails a round in which a variant's page renders other text than Paraglide's. */
function checkTexts(app, names, measured) {
	for (const locale of localesOf(app))
		for (const name of names)
			if (
				measured.get(name)[locale].text !==
				measured.get("Paraglide")[locale].text
			)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale}`,
				);
}

function report(app, names, kept) {
	const byRound = (name, locale) =>
		kept.map(({ measured }) => median(measured.get(name)[locale].samples));
	console.log(
		`\n### ${app.name}: Svelte SSR of a page with ${PAGE_CALLS} message calls (Paraglide ${paraglideVersion}, Node ${process.versions.node}), medians of ${kept.length} rounds at a load of ${kept.map(({ load }) => load.toFixed(0)).join(", ")}\n`,
	);
	console.log(
		"| variant | locale | ms per render | messages' share | × grai's (interval) |",
	);
	console.log("|---|---|---|---|---|");
	const recorded = [];
	for (const locale of localesOf(app)) {
		const inlined = median(byRound(INLINED, locale));
		for (const name of names) {
			const ns = median(byRound(name, locale));
			const ratio = pairedRatio(byRound(name, locale), byRound(GRAI, locale));
			console.log(
				`| ${name} | ${locale} | ${formatNs(ns / 1e6)} | ${((100 * (ns - inlined)) / ns).toFixed(0)}% | ${ratioText(ratio)} |`,
			);
			recorded.push({
				variant: name,
				locale,
				ns,
				against: GRAI,
				ratio,
				rounds: byRound(name, locale),
				samples: kept.map(({ measured }) => measured.get(name)[locale].samples),
			});
		}
	}
	recordResults(`ssr-${app.id}`, recorded, {
		app: app.name,
		calls: PAGE_CALLS,
		samplesPerRound: SAMPLES,
		rounds: roundsRecord(kept),
	});
}

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4]);
} else {
	for (const app of selectedApps()) {
		const plan = { app: app.id, variants: await buildVariants(app) };
		const planFile = join(cacheDir, "page", app.id, "ssr-plan.json");
		writeFileSync(planFile, JSON.stringify(plan));
		const names = Object.keys(plan.variants);
		const kept = await inRounds(names, roundCount(names.length, 2), (name) =>
			inProcess(self, ["--child", planFile, name]),
		);
		for (const { measured } of kept) checkTexts(app, names, measured);
		report(app, names, kept);
	}
}
