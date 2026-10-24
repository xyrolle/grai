// A message-heavy page as Svelte compiles it, for the render and hydration benches: a shell of 400
// distinct labels, then a table of 100 rows, each with 16 message calls beside 8 data cells, so
// 2,000 calls in all. Each variant takes its messages from somewhere else: Paraglide's output,
// grai's server entry or per-locale module, or text inlined into the template at compile time.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { cacheDir } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";

export const SHELL_CALLS = 400;
export const ROWS = 100;
const CALLS_PER_ROW = 16;
const DATA_PER_ROW = 8;
export const PAGE_CALLS = SHELL_CALLS + ROWS * CALLS_PER_ROW;

const escapeText = (text) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/\{/g, "&#123;")
		.replace(/\}/g, "&#125;");

/** Message text with its inputs as Svelte expressions on `inputs`, for the inlined variant. */
function inlineText(pattern, inputs) {
	return pattern
		.replace(/\{([^{}]*)\}/g, (_, inside) =>
			inside.startsWith("#") || inside.startsWith("/")
				? ""
				: `\0{${inputs}.${inside}}\0`,
		)
		.split("\0")
		.map((part, index) => (index % 2 === 1 ? part : escapeText(part)))
		.join("");
}

/**
 * The page's Svelte source. `from` is the module messages are imported from; `inline` gives the
 * locale's catalog when text is inlined instead (plurals still call their function).
 */
export function pageSource(app, { from, inline }) {
	const calls = sampleCalls(app, SHELL_CALLS + CALLS_PER_ROW);
	const keys = [...new Set(calls.map((call) => call.key))];
	const alias = new Map(keys.map((key, index) => [key, `k${index}`]));
	const expression = (call, inputs) => {
		const value = inline?.[call.key];
		if (typeof value === "string") return inlineText(value, inputs);
		return `{${alias.get(call.key)}(${call.kind === "text" ? "" : inputs})}`;
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
	return `<script>
	import { ${keys.map((key) => `${JSON.stringify(key)} as ${alias.get(key)}`).join(", ")} } from ${JSON.stringify(from)};
	let { inputs, rows } = $props();
</script>
<header>${shell.join("")}</header>
<table><tbody>
{#each rows as row (row.id)}<tr>${rowCalls.join("")}${dataCells.join("")}</tr>{/each}
</tbody></table>
`;
}

/** What a reader sees: the text alone, as the DOM holds it, whitespace collapsed as HTML shows it. */
export const visibleText = (html) =>
	html
		.replace(/<[^>]*>/g, " ")
		.replace(/&#123;/g, "{")
		.replace(/&#125;/g, "}")
		.replace(/\s+/g, " ")
		.trim();

/** The props the page renders: the sample's inputs and the table's rows. */
export function pageProps(app) {
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
	return { inputs: calls.map((call) => call.inputs), rows };
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
