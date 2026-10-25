// Server: what a message call costs inside a request, in Node: grai's output as its Vite plugin
// builds it for a server, called as an app calls it and with a forced locale, against Paraglide,
// i18next and use-intl, and against the prototype's dispatchers that grai did not adopt. Each
// variant makes the same 2,000 calls (render-calls.mjs), of each kind and in the page's mix, and
// its text is checked against Paraglide's before it is timed. A message with markup is drawn from
// its parts; i18next has none.
//   node server.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, selectedApps } from "./apps.mjs";
import { callValues } from "./call-values.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { graiServerBuild } from "./grai.mjs";
import { nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
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

/** The libraries' variants, then the floor of Paraglide's calls and the shapes grai did not adopt. */
async function variants(app, locale) {
	const prototype = writePrototype(app);
	const grai = join(await graiServerBuild(app), "keys.js");
	return {
		...(await libraryVariants(app, locale, grai)),
		"Paraglide `getLocale()` alone": {
			from: join(await paraglideOutput(app), "runtime.js"),
			name: () => "getLocale",
			call: (_, f) => `${f}()`,
			markup: {},
			renders: false,
		},
		"prototype, dispatcher per key, ALS": {
			from: join(prototype, "server.js"),
			call: plainCall,
		},
		"prototype, dispatcher per key, module variable": {
			from: join(prototype, "server-variable.js"),
			call: plainCall,
		},
	};
}

async function benchLocale(app, locale) {
	const rows = new Map();
	const all = Object.entries(await variants(app, locale));
	for (const kind of KINDS) {
		const calls = sampleCalls(app, CALLS, kind === "page" ? undefined : kind);
		if (calls.length === 0) continue;
		const values = callValues(withValues(app, calls), locale);
		const directory = join(cacheDir, "server", app.id, kind);
		mkdirSync(directory, { recursive: true });
		let expected;
		for (const [index, [name, variant]] of all.entries()) {
			const spec = callsOf(variant, kind);
			if (spec === undefined) continue;
			const path = join(directory, `${index}-${locale}.mjs`);
			writeFileSync(path, renderSource(calls, spec));
			const { render } = await import(path);
			const text = await inRequest(app, locale, () => render(values));
			expected ??= text;
			if (spec.renders !== false && text !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale} (${kind})`,
				);
			const ns = await inRequest(app, locale, () =>
				nanosecondsPer(() => render(values), calls.length),
			);
			rows.set(name, { ...rows.get(name), [kind]: ns });
		}
	}
	for (const [name, ns] of rows) console.log(tableRow(name, locale, ns));
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
	const mix = kindsOf(sampleCalls(app, CALLS));
	console.log(
		`\n### ${app.name}: Paraglide ${paraglideVersion}, Node ${process.versions.node}, page of ${CALLS} calls ${JSON.stringify(mix)}\n`,
	);
	console.log(TABLE_HEAD);
	for (const locale of [app.baseLocale, otherLocale(app)])
		await benchLocale(app, locale);
}
