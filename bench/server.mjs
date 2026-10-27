// Server: what a message call costs inside a request, in Node: grai's output called as an app
// calls it and with a forced locale, against Paraglide, i18next and use-intl, and against the
// prototype's dispatchers that grai did not adopt. Each variant makes the same 2,000 calls
// (render-calls.mjs), of each kind and in the page's mix, built as an app's server build has them,
// with its library's own plugins, beside its server entry (production.mjs). Its text is checked
// against Paraglide's before it is timed. A message with markup is drawn from its parts; i18next
// has none. The clock is a warm batch inside one request: each run of the calls, divided by their
// number, after a warm-up; the imports, the inputs and the middleware are outside it.
//   node server.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, selectedApps } from "./apps.mjs";
import { callValues } from "./call-values.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { nanosecondsPer } from "./measure.mjs";
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

/** Times the built calls in a locale, and returns each variant's nanoseconds a call, by kind. */
async function benchLocale(app, plan, locale) {
	const rows = new Map();
	for (const kind of KINDS) {
		const calls = callsFor(app, kind);
		if (calls.length === 0) continue;
		const values = callValues(withValues(app, calls), locale);
		let expected;
		for (const [name, variant] of Object.entries(plan)) {
			const cell = variant.cells.find(
				(each) => each.kind === kind && each.locale === locale,
			);
			if (cell === undefined) continue;
			const server =
				variant.server === undefined
					? {}
					: await import(join(variant.directory, "server.js"));
			const { render } = await import(
				join(variant.directory, `${cellOf(kind, locale)}.js`)
			);
			const text = await inRequest(app, locale, server, () => render(values));
			expected ??= text;
			if (cell.renders && text !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale} (${kind})`,
				);
			const ns = await inRequest(app, locale, server, () =>
				nanosecondsPer(() => render(values), calls.length),
			);
			rows.set(name, { ...rows.get(name), [kind]: ns });
		}
	}
	for (const [name, ns] of rows) console.log(tableRow(name, locale, ns));
	return [...rows].map(([name, ns]) => ({ variant: name, locale, ns }));
}

const apps = selectedApps();
if (apps.length > 1) {
	// Each app in a process of its own: the modules of all three no longer fit one heap.
	for (const app of apps)
		execFileSync(
			process.execPath,
			[new URL(import.meta.url).pathname, app.id],
			{ stdio: "inherit" },
		);
} else {
	const [app] = apps;
	const plan = await buildVariants(app);
	const mix = kindsOf(callsFor(app, "page"));
	console.log(
		`\n### ${app.name}: Paraglide ${paraglideVersion}, Node ${process.versions.node}, page of ${CALLS} calls ${JSON.stringify(mix)}\n`,
	);
	console.log(TABLE_HEAD);
	const recorded = [];
	for (const locale of localesOf(app))
		recorded.push(...(await benchLocale(app, plan, locale)));
	recordResults(`server-${app.id}`, recorded, {
		app: app.name,
		calls: CALLS,
		mix,
	});
}
