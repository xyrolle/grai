import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import { outputImports } from "./output-imports.ts";

/** The custom HMR event that carries an edit's patch, and the event the page dispatches after it. */
export const updateEvent = "grai:update";
export const changeEvent = "grai:change";

/**
 * keys.js in dev: every key, with its locales in a table, and the handler that writes an edit's
 * patch into the table. After a patch the page dispatches a cancelable `grai:change` on
 * `window`: a framework adapter that renders again cancels it, and otherwise the page reloads.
 * Each key passes its name after its variants, for the runtime's errors to name. A build leaves
 * names out: they would add about a third to a page's gzipped message bytes.
 */
export function devModule(outdir: string, build: Build): string {
	const keys = [...build.compilation.keys];
	const exports = keys.map(([key, compiled]) => {
		const name = JSON.stringify(key);
		return compiled.kind === "markup"
			? `export const ${key} = markup(live(${name}, "v"), live(${name}, "p"));`
			: `export const ${key} = message(...live(${name}, "v"));`;
	});
	return `${outputImports(outdir, build.compilation.keys.values(), ["markup", "message"])}
const T = {
${keys.map(([key, compiled]) => `\t${key}: ${row(compiled)},`).join("\n")}
};
const live = (key, field) => [...T[key][field].map((_, n) => (inputs) => {
	const variant = T[key][field][n];
	return typeof variant === "function" ? variant(inputs) : variant;
}), key];
${exports.join("\n")}
if (import.meta.hot) {
	import.meta.hot.on(${JSON.stringify(updateEvent)}, async ({ url }) => {
		const { rows } = await import(/* @vite-ignore */ url);
		for (const [key, row] of Object.entries(rows)) Object.assign(T[key], row);
		if (typeof window !== "undefined" && window.dispatchEvent(new CustomEvent(${JSON.stringify(changeEvent)}, { cancelable: true }))) location.reload();
	});
}
`;
}

/** An edit's patch: the changed keys' rows, which the page writes into its table. */
export function patchModule(
	outdir: string,
	build: Build,
	changed: readonly string[],
): string {
	const keys = changed.flatMap((key) => build.compilation.keys.get(key) ?? []);
	const rows = changed.map(
		(key) => `\t${key}: ${row(build.compilation.keys.get(key))},`,
	);
	return `${outputImports(outdir, keys, [])}\nexport const rows = {\n${rows.join("\n")}\n};\n`;
}

/** A key's row in the dev table: its locales' variants, and their parts for markup. */
function row(compiled: CompiledKey | undefined): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup" ? `, p: [${compiled.parts.join(", ")}]` : "";
	return `{ v: [${compiled.variants.join(", ")}]${parts} }`;
}
