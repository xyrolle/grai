// The calls `server` and `client` time: every call of the sample through its own call site, 20 to
// a function as a component holds them, so the engine optimizes them as it would a real render. A
// variant says where each call's message comes from and how the call is written; for a message
// with markup, how it is drawn from its parts, where the library has them.
import { join } from "node:path";
import { takesInputs } from "./calls.mjs";
import { i18nextValues, writeLibraryModules } from "./libraries.mjs";
import { formatNs } from "./measure.mjs";
import { paraglideOutput } from "./paraglide.mjs";

export const CALLS = 2000;
const PER_FUNCTION = 20;
const values = new URL("call-values.mjs", import.meta.url).pathname;

/** What each kind of bench calls: one kind of message, or the page's own mix of them all. */
export const KINDS = ["text", "inputs", "plural", "markup", "page"];

/**
 * A module whose `render(d)` makes every call through its own call site, with `d` the calls'
 * values (call-values.mjs). `name` says what a call imports from `from`; `call` writes the call
 * from the call, the imported binding and the call's position.
 */
export function renderSource(calls, { from, name = (c) => c.key, call }) {
	const imported = [...new Set(calls.map(name))];
	const alias = new Map(imported.map((each, index) => [each, `k${index}`]));
	const lines = [
		`import { show } from ${JSON.stringify(values)};`,
		`import { ${imported.map((each) => `${JSON.stringify(each)} as ${alias.get(each)}`).join(", ")} } from ${JSON.stringify(from)};`,
	];
	const parts = [];
	for (let start = 0; start < calls.length; start += PER_FUNCTION) {
		const body = calls
			.slice(start, start + PER_FUNCTION)
			.map(
				(c, offset) => `\ts += ${call(c, alias.get(name(c)), start + offset)};`,
			);
		lines.push(
			`function part${parts.length}(d) {\n\tlet s = "";\n${body.join("\n")}\n\treturn s;\n}`,
		);
		parts.push(`part${parts.length}(d)`);
	}
	lines.push(`export function render(d) {\n\treturn ${parts.join(" + ")};\n}`);
	return `${lines.join("\n")}\n`;
}

/** The calls with what call-values.mjs needs of the app: i18next's values. */
export const withValues = (app, calls) =>
	calls.map((call) => ({
		...call,
		i18next: i18nextValues(app, call.key, call.inputs),
	}));

/** How a variant makes the calls of `kind`, or nothing when it cannot draw markup. */
export function callsOf(variant, kind) {
	if (kind !== "markup") return variant;
	return variant.markup && { ...variant, ...variant.markup };
}

const inputs = (c, n) => (takesInputs(c) ? `d[${n}]` : "");
/** A call as an app writes it: no inputs to a message that takes none. */
export const plainCall = (c, f, n) => `${f}(${inputs(c, n)})`;
const forced = (_, f, n) => `${f}(d[${n}], d.options)`;
const parts = (c, f, n) => `show(${f}.parts(${inputs(c, n)}))`;
const forcedParts = (_, f, n) => `show(${f}.parts(d[${n}], d.options))`;

/** A call of a library's `t(key, values)`, with the values of `field` in call-values.mjs. */
const translate = (field) => (c, f, n) =>
	`${f}(${JSON.stringify(c.key)}, ${field}[${n}])`;

/**
 * The libraries' variants in `locale`: grai's output and Paraglide's, as an app calls them, and
 * i18next and use-intl. `grai` is the module grai's messages come from: on a server, its server
 * build, and in a page, the output its client build reads.
 */
export async function libraryVariants(app, locale, grai) {
	const paraglide = join(await paraglideOutput(app), "messages.js");
	const { directory } = writeLibraryModules(app, locale);
	const library = (name) => join(directory, `${locale}.${name}.js`);
	return {
		"Paraglide `m.key()`": {
			from: paraglide,
			call: plainCall,
			markup: { call: parts },
		},
		"Paraglide `m.key(i, { locale })`": {
			from: paraglide,
			call: forced,
			markup: { call: forcedParts },
		},
		"grai `m.key()`": { from: grai, call: plainCall, markup: { call: parts } },
		"grai `m.key(i, { locale })`": {
			from: grai,
			call: forced,
			markup: { call: forcedParts },
		},
		"i18next `t(key, values)`": {
			from: library("i18next"),
			name: () => "t",
			call: translate("d.i18next"),
		},
		"use-intl `t(key, values)`, `t.markup`": {
			from: library("use-intl"),
			name: () => "t",
			call: translate("d"),
			markup: { name: () => "markup", call: translate("d.useIntl") },
		},
	};
}

/** The head of the table `server` and `client` print. */
export const TABLE_HEAD = `| variant | locale | text ns/call | inputs ns/call | plural ns/call | markup ns/call | page µs/${CALLS.toLocaleString("en")} calls |
|---|---|---|---|---|---|---|`;

/** A row of that table: a variant's nanoseconds a call of each kind, and what the page's calls take. */
export function tableRow(name, locale, ns) {
	const cell = (value) => (value === undefined ? "—" : formatNs(value));
	const page =
		ns.page === undefined ? "—" : ((ns.page * CALLS) / 1000).toFixed(1);
	return `| ${name} | ${locale} | ${cell(ns.text)} | ${cell(ns.inputs)} | ${cell(ns.plural)} | ${cell(ns.markup)} | ${page} |`;
}
