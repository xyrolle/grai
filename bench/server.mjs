// Server: what a message call costs inside a request, in Node: grai's output called as an app
// calls it and with a forced locale, against Paraglide, i18next and use-intl, and against the
// prototype's dispatchers that grai did not adopt. Each variant makes the same 2,000 calls
// (render-calls.mjs), of each kind and in the page's mix, built as an app's server build has them,
// with its library's own plugins, beside its server entry (production.mjs). Its text is checked
// against Paraglide's before it is timed. A message with markup is drawn from its parts; i18next
// has none. The clock is a warm batch inside one request: each run of the calls, divided by their
// number, after a warm-up; the imports, the inputs and the middleware are outside it.
//
// Each variant runs in a process of its own, once a round, in an order that rotates from round to
// round (rounds.mjs). Its figure for a kind is the median of its rounds, each the median of
// SAMPLES batches; every sample is kept, with each round's ratio to grai's.
//   ROUNDS=9 node server.mjs [app...]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, selectedApps } from "./apps.mjs";
import { callValues } from "./call-values.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { nanosecondSamples } from "./measure.mjs";
import { median } from "./medians.mjs";
import { paraglideForVite, paraglideVersion } from "./paraglide.mjs";
import { pluginsOf, serverBuild } from "./production.mjs";
import { writePrototype } from "./prototype.mjs";
import {
	CALLS,
	callsOf,
	KINDS,
	libraryVariants,
	plainCall,
	renderSource,
	TABLE_HEAD,
	tableRow,
	withValues,
} from "./render-calls.mjs";
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

/** The timed batches a variant takes in each kind and locale, each round. */
const SAMPLES = 11;
const self = new URL(import.meta.url).pathname;
const GRAI = "grai `m.key()`";
const GRAI_GIVEN = "grai `m.key(i, { locale })`";
/** The variants given each call's locale, which are compared with grai's given it too. */
const GIVEN = new Set(["Paraglide `m.key(i, { locale })`", GRAI_GIVEN]);

/** The libraries' variants, then the floor of Paraglide's calls and the shapes grai did not adopt. */
async function variants(app, locale) {
	const paraglide = await paraglideForVite(app);
	const prototype = writePrototype(app);
	const prototypeEntry = (file) => ({
		library: "prototype",
		server: join(prototype, file),
		from: join(prototype, file),
		call: plainCall,
	});
	return {
		...(await libraryVariants(app, locale)),
		"Paraglide `getLocale()` alone": {
			library: "paraglide",
			server: join(paraglide, "server.js"),
			from: join(paraglide, "runtime.js"),
			name: () => "getLocale",
			call: (_, f) => `${f}()`,
			markup: {},
			renders: false,
		},
		"prototype, dispatcher per key, ALS": prototypeEntry("server.js"),
		"prototype, dispatcher per key, module variable":
			prototypeEntry("server-variable.js"),
	};
}

const localesOf = (app) => [app.baseLocale, otherLocale(app)];
const cellOf = (kind, locale) => `${kind}-${locale}`;
const callsFor = (app, kind) =>
	sampleCalls(app, CALLS, kind === "page" ? undefined : kind);

/**
 * Writes each variant's calls, kind by kind in each locale, and builds them as an app's server
 * build has them, beside the library's server entry. Returns, by name, each variant's build and
 * the cells it measures, for the processes that time them.
 */
async function buildVariants(app) {
	const plan = {};
	for (const locale of localesOf(app)) {
		const all = Object.entries(await variants(app, locale));
		for (const kind of KINDS) {
			const calls = callsFor(app, kind);
			if (calls.length === 0) continue;
			for (const [index, [name, variant]] of all.entries()) {
				const spec = callsOf(variant, kind);
				if (spec === undefined) continue;
				const root = join(cacheDir, "server", app.id, String(index));
				mkdirSync(join(root, "src"), { recursive: true });
				const cell = cellOf(kind, locale);
				const source = join(root, "src", `${cell}.js`);
				writeFileSync(source, renderSource(calls, spec));
				plan[name] ??= {
					library: variant.library,
					server: variant.server,
					root,
					directory: join(root, "dist"),
					modules: {},
					cells: [],
				};
				plan[name].modules[cell] = source;
				plan[name].cells.push({
					kind,
					locale,
					renders: spec.renders !== false,
				});
			}
		}
	}
	for (const variant of Object.values(plan)) {
		const server =
			variant.server === undefined ? {} : { server: variant.server };
		await serverBuild(
			variant.root,
			variant.directory,
			{ ...server, ...variant.modules },
			await pluginsOf(variant.library, app),
		);
	}
	return plan;
}

/** Runs in the child: the variant's calls, cell by cell, their text's hash and their samples. */
async function child(planFile, name) {
	const plan = JSON.parse(readFileSync(planFile, "utf8"));
	const [app] = selectedApps([plan.app]);
	const variant = plan.variants[name];
	const server =
		variant.server === undefined
			? {}
			: await import(join(variant.directory, "server.js"));
	const measured = {};
	for (const { kind, locale } of variant.cells) {
		const calls = callsFor(app, kind);
		const values = callValues(withValues(app, calls), locale);
		const cell = cellOf(kind, locale);
		const { render } = await import(join(variant.directory, `${cell}.js`));
		const text = await inRequest(app, locale, server, () => render(values));
		const samples = await inRequest(app, locale, server, () =>
			nanosecondSamples(() => render(values), calls.length, {
				samples: SAMPLES,
			}),
		);
		measured[cell] = {
			text: createHash("sha256").update(text).digest("hex"),
			samples,
		};
	}
	console.log(JSON.stringify(measured));
}

/** Fails a round in which a variant's calls render other text than Paraglide's. */
function checkTexts(plan, measured) {
	const expected = measured.get("Paraglide `m.key()`");
	for (const [name, variant] of Object.entries(plan.variants))
		for (const { kind, locale, renders } of variant.cells) {
			const cell = cellOf(kind, locale);
			if (renders && measured.get(name)[cell].text !== expected[cell].text)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale} (${kind})`,
				);
		}
}

/** Prints and records the rounds: each variant's figures by kind, and their ratios to grai's. */
function report(app, plan, kept) {
	const mix = kindsOf(callsFor(app, "page"));
	const byRound = (name, cell) =>
		kept.map(({ measured }) => median(measured.get(name)[cell].samples));
	console.log(
		`\n### ${app.name}: Paraglide ${paraglideVersion}, Node ${process.versions.node}, page of ${CALLS} calls ${JSON.stringify(mix)}, medians of ${kept.length} rounds at a load of ${kept.map(({ load }) => load.toFixed(0)).join(", ")}\n`,
	);
	console.log(TABLE_HEAD);
	const recorded = [];
	for (const locale of localesOf(app))
		for (const [name, variant] of Object.entries(plan.variants)) {
			const against = GIVEN.has(name) ? GRAI_GIVEN : GRAI;
			const kinds = variant.cells
				.filter((cell) => cell.locale === locale)
				.map(({ kind }) => kind);
			const each = (figure) =>
				Object.fromEntries(
					kinds.map((kind) => [kind, figure(cellOf(kind, locale))]),
				);
			const row = {
				variant: name,
				locale,
				ns: each((cell) => median(byRound(name, cell))),
				against,
				ratio: each((cell) =>
					pairedRatio(byRound(name, cell), byRound(against, cell)),
				),
				rounds: each((cell) => byRound(name, cell)),
				samples: each((cell) =>
					kept.map(({ measured }) => measured.get(name)[cell].samples),
				),
			};
			console.log(tableRow(name, locale, row.ns));
			recorded.push(row);
		}
	console.log(
		`\nEach variant against grai's calls of the same shape, in the same round: the median ratio and its interval.\n\n| variant | locale | ${KINDS.join(" | ")} |\n|---|---|${KINDS.map(() => "---|").join("")}`,
	);
	for (const row of recorded)
		console.log(
			`| ${row.variant} | ${row.locale} | ${KINDS.map((kind) => (row.ratio[kind] ? ratioText(row.ratio[kind]) : "—")).join(" | ")} |`,
		);
	recordResults(`server-${app.id}`, recorded, {
		app: app.name,
		calls: CALLS,
		mix,
		samplesPerRound: SAMPLES,
		rounds: roundsRecord(kept),
	});
}

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4]);
} else {
	for (const app of selectedApps()) {
		const plan = { app: app.id, variants: await buildVariants(app) };
		const planFile = join(cacheDir, "server", app.id, "plan.json");
		writeFileSync(planFile, JSON.stringify(plan));
		const names = Object.keys(plan.variants);
		const kept = await inRounds(names, roundCount(names.length), (name) =>
			inProcess(self, ["--child", planFile, name]),
		);
		for (const { measured } of kept) checkTexts(plan, measured);
		report(app, plan, kept);
	}
}
