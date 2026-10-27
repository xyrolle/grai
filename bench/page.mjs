// A message-heavy page as Svelte compiles it, for the render and hydration benches: a shell of 400
// distinct labels, then a table of 100 rows, each with 16 message calls beside 8 data cells, so
// 2,000 calls in all. Each variant takes its messages from somewhere else: Paraglide's output,
// grai's server entry or per-locale module, or text inlined into the template at compile time.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { cacheDir } from "./apps.mjs";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { escapeText, keptSpaces, splitEdges } from "./svelte-text.mjs";

export const SHELL_CALLS = 400;
export const ROWS = 100;
const CALLS_PER_ROW = 16;
const DATA_PER_ROW = 8;
export const PAGE_CALLS = SHELL_CALLS + ROWS * CALLS_PER_ROW;

const markupTag = /\{[#/][^{}]*\}/g;

/**
 * Message text without its markup, its inputs as Svelte expressions on `inputs`, for the inlined
 * variant. Svelte trims the whitespace at the edges of an element's static text, so the text's own
 * edge whitespace goes in as expressions.
 */
function inlineText(pattern, inputs) {
	const { leading, body, trailing } = splitEdges(
		pattern.replace(markupTag, ""),
	);
	const template = body
		.split(/(\{[^{}]*\})/)
		.map((part, index) =>
			index % 2 === 1 ? `{${inputs}.${part.slice(1, -1)}}` : escapeText(part),
		)
		.join("");
	return `${keptSpaces(leading)}${template}${keptSpaces(trailing)}`;
}

/**
 * The page's Svelte source. `from` is the module messages are imported from, or a key's own path
 * for each key, as `(key) => path`; `inline` gives the locale's catalog when text is inlined
 * instead (plurals still call their function), and `translate` calls a library's
 * `t(key, values)` from `from` instead.
 */
export function pageSource(app, { from, inline, translate }) {
	const calls = sampleCalls(app, SHELL_CALLS + CALLS_PER_ROW);
	const keys = translate ? ["t"] : [...new Set(calls.map((call) => call.key))];
	const alias = new Map(keys.map((key, index) => [key, `k${index}`]));
	const expression = (call, inputs) => {
		const value = inline?.[call.key];
		if (typeof value === "string") return inlineText(value, inputs);
		if (translate) return `{k0(${JSON.stringify(call.key)}, ${inputs})}`;
		return `{${alias.get(call.key)}(${takesInputs(call) ? inputs : ""})}`;
	};
	const shell = calls
		.slice(0, SHELL_CALLS)
		.map(
			(call, index) => `<span>${expression(call, `inputs[${index}]`)}</span>`,
		);
	const rowCalls = calls
		.slice(SHELL_CALLS)
		.map(
			(call, index) =>
				`<td>${expression(call, `inputs[${SHELL_CALLS + index}]`)}</td>`,
		);
	const dataCells = Array.from(
		{ length: DATA_PER_ROW },
		(_, index) => `<td>{row.c${index}}</td>`,
	);
	const named = (key) => `${JSON.stringify(key)} as ${alias.get(key)}`;
	const imports =
		typeof from === "function"
			? keys.map(
					(key) =>
						`import { ${named(key)} } from ${JSON.stringify(from(key))};`,
				)
			: [
					`import { ${keys.map(named).join(", ")} } from ${JSON.stringify(from)};`,
				];
	return `<script>
	${imports.join("\n\t")}
	let { inputs, rows } = $props();
</script>
<header>${shell.join("")}</header>
<table><tbody>
{#each rows as row (row.id)}<tr>${rowCalls.join("")}${dataCells.join("")}</tr>{/each}
</tbody></table>
`;
}

/** The keys the page calls: its shell's and its rows', each once. */
export const pageKeys = (app) => [
	...new Set(
		sampleCalls(app, SHELL_CALLS + CALLS_PER_ROW).map((call) => call.key),
	),
];

/**
 * The page's text exactly as the DOM holds it, whitespace and all: its tags and Svelte's
 * hydration comments dropped, and the entities Svelte writes read back.
 */
export const pageText = (html) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&#123;/g, "{")
		.replace(/&#125;/g, "}")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");

/** The props the page renders: each call's values, as `values` writes them, and the table's rows. */
export function pageProps(app, values = (call) => call.inputs) {
	const calls = sampleCalls(app, SHELL_CALLS + CALLS_PER_ROW);
	const rows = Array.from({ length: ROWS }, (_, id) => ({
		id,
		...Object.fromEntries(
			Array.from({ length: DATA_PER_ROW }, (_, c) => [
				`c${c}`,
				`${id}-${c} value`,
			]),
		),
	}));
	return { inputs: calls.map(values), rows };
}

/** Compiles a page for the server or the browser and writes it beside the others; returns its path. */
export function writePage(app, name, source, generate) {
	const directory = join(cacheDir, "page", app.id);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, `${name}.svelte`), source);
	const { js } = compile(source, { generate, filename: `${name}.svelte` });
	const path = join(directory, `${name}.${generate}.js`);
	writeFileSync(path, js.code);
	return path;
}
