// Server: what a message call costs inside a request: Paraglide, i18next and use-intl against the
// shapes grai could take.
// Each variant renders the same 2,000 calls through static call sites, 20 to a function as a
// component holds them, so the engine optimizes them as it would a real render. Every variant's
// text is checked against Paraglide's before it is timed.
//   node server.mjs [app...]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, selectedApps } from "./apps.mjs";
import { kindsOf, sampleCalls } from "./calls.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { template, writePrototype } from "./prototype.mjs";
import { inRequest, otherLocale } from "./request.mjs";

const CALLS = 2000;
const PER_FUNCTION = 20;

/**
 * A module whose `render(d)` makes every call of the sample through its own call site. `names`
 * says what each call imports from `from`; `call` writes the expression.
 */
async function renderModule(path, calls, { from, names = (c) => c.key, call }) {
	const imported = [...new Set(calls.map(names))];
	const alias = new Map(imported.map((name, index) => [name, `k${index}`]));
	const lines = [
		`import { ${imported.map((name) => `${JSON.stringify(name)} as ${alias.get(name)}`).join(", ")} } from ${JSON.stringify(from)};`,
	];
	const parts = [];
	for (let start = 0; start < calls.length; start += PER_FUNCTION) {
		const body = calls
			.slice(start, start + PER_FUNCTION)
			.map(
				(c, offset) =>
					`\ts += ${call(c, alias.get(names(c)), `d[${start + offset}]`)};`,
			);
		lines.push(
			`function part${parts.length}(d) {\n\tlet s = "";\n${body.join("\n")}\n\treturn s;\n}`,
		);
		parts.push(`part${parts.length}(d)`);
	}
	lines.push(`export function render(d) {\n\treturn ${parts.join(" + ")};\n}`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return import(path);
}

/** A plain call: inputs only where the message has some. */
const direct = (c, f, d) => `${f}(${c.kind === "text" ? "" : d})`;

/** The variants, each a module rendering `calls` in `locale`. */
async function variants(app, locale, calls, directory) {
	const paraglide = await paraglideOutput(app);
	const prototype = writePrototype(app);
	const messages = join(paraglide, "messages.js");
	const localeModule = join(prototype, `${locale}.js`);
	const write = (file, spec) =>
		renderModule(join(directory, `${file}-${locale}.mjs`), calls, spec);
	const inlined = (c, f, d) => {
		const value = app.messages[locale][c.key];
		return typeof value === "string"
			? template(value).replaceAll("${i.", `\${${d}.`)
			: `${f}(${d})`;
	};
	const from = (file) => join(prototype, file);
	const { directory: libraries } = writeLibraryModules(app, locale);
	return {
		"Paraglide `m.key()`": await write("paraglide", {
			from: messages,
			call: direct,
		}),
		"Paraglide `m.key(i, { locale })`": await write("paraglide-locale", {
			from: messages,
			call: (_, f, d) => `${f}(${d}, d.options)`,
		}),
		"Paraglide `getLocale()` alone": await write("getlocale", {
			from: join(paraglide, "runtime.js"),
			names: () => "getLocale",
			call: (_, f) => `${f}()`,
		}),
		"grai, shared dispatcher, ALS": await write("shared", {
			from: from("server-shared.js"),
			call: direct,
		}),
		"grai, dispatcher per key, ALS": await write("per-key", {
			from: from("server.js"),
			call: direct,
		}),
		"grai, dispatcher per key, module variable": await write("variable", {
			from: from("server-variable.js"),
			call: direct,
		}),
		"grai, per-locale module": await write("module", {
			from: localeModule,
			call: direct,
		}),
		"inlined at the call site": await write("inlined", {
			from: localeModule,
			call: inlined,
		}),
		"i18next `t(key, values)`": await write("i18next", {
			from: join(libraries, `${locale}.i18next.js`),
			names: () => "t",
			call: (c, f, d) =>
				`${f}(${JSON.stringify(c.key)}, ${d.replace("d[", "d.i18next[")})`,
		}),
		"use-intl `t(key, values)` (intl-messageformat)": await write("use-intl", {
			from: join(libraries, `${locale}.use-intl.js`),
			names: () => "t",
			call: (c, f, d) => `${f}(${JSON.stringify(c.key)}, ${d})`,
		}),
	};
}

async function benchLocale(app, locale) {
	const rows = new Map();
	for (const kind of ["text", "inputs", "plural", "page"]) {
		const calls = sampleCalls(app, CALLS, kind === "page" ? undefined : kind);
		const data = Object.assign(
			calls.map((c) => c.inputs),
			{
				options: { locale },
				i18next: calls.map((c) => i18nextValues(app, c.key, c.inputs)),
			},
		);
		const directory = join(cacheDir, "server", app.id, kind);
		mkdirSync(directory, { recursive: true });
		const modules = await variants(app, locale, calls, directory);
		const expected = await inRequest(app, locale, () =>
			modules["Paraglide `m.key()`"].render(data),
		);
		for (const [name, module] of Object.entries(modules)) {
			const text = await inRequest(app, locale, () => module.render(data));
			if (!name.includes("getLocale") && text !== expected)
				throw new Error(
					`${name} renders other text than Paraglide in ${locale} (${kind})`,
				);
			const ns = await inRequest(app, locale, () =>
				nanosecondsPer(() => module.render(data), CALLS),
			);
			rows.set(name, { ...rows.get(name), [kind]: ns });
		}
	}
	for (const [name, ns] of rows) {
		console.log(
			`| ${name} | ${locale} | ${formatNs(ns.text)} | ${formatNs(ns.inputs)} | ${formatNs(ns.plural)} | ${((ns.page * CALLS) / 1000).toFixed(1)} |`,
		);
	}
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
	console.log(
		"| variant | locale | text ns/call | inputs ns/call | plural ns/call | page µs/2,000 calls |",
	);
	console.log("|---|---|---|---|---|---|");
	for (const locale of [app.baseLocale, otherLocale(app)])
		await benchLocale(app, locale);
}
