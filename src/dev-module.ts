import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import { keyExports } from "./key-exports.ts";
import {
	calledNames,
	everyName,
	inOutdir,
	outputImports,
} from "./output-imports.ts";

/** The custom HMR event that carries an edit's patch, and the event the page dispatches after it. */
export const updateEvent = "grai:update";
export const changeEvent = "grai:change";

/** The dev module's table's helper: a key's live variants, each reading the table as it is called. */
const liveCode = `const live = (key, field) => [...T[key][field].map((_, n) => (inputs) => {
	const variant = T[key][field][n];
	return typeof variant === "function" ? variant(inputs) : variant;
}), key];
`;

/** The dev module's handler of an edit's patch, which writes it into the table. */
const patchCode = `if (import.meta.hot) {
	import.meta.hot.on(${JSON.stringify(updateEvent)}, async ({ url }) => {
		const { rows } = await import(/* @vite-ignore */ url);
		for (const [key, row] of Object.entries(rows)) Object.assign(T[key], row);
		if (typeof window !== "undefined" && window.dispatchEvent(new CustomEvent(${JSON.stringify(changeEvent)}, { cancelable: true }))) location.reload();
	});
}
`;

/**
 * Every word of the dev module's own code, as written: each name it binds or calls, `T`, `live`,
 * `window` or `location`, and some it need not, so that a key named like any of them binds a
 * name of its own.
 */
const devWords = new Set(
	`T ${liveCode}${patchCode}`.match(/[A-Za-z_$][\w$]*/g),
);

/**
 * keys.js in dev: every key, with its locales in a table, and the handler that writes an edit's
 * patch into the table, in the page and in a server's module runner alike. After a patch the page
 * dispatches a cancelable `grai:change` on `window`: a framework adapter that renders again
 * cancels it, and otherwise the page reloads. Each key passes its name after its variants, for
 * the runtime's errors to name. A build leaves names out: they would add about a third to a page's
 * gzipped message bytes.
 */
export function devModule(outdir: string, build: Build): string {
	const keys = [...build.compilation.keys];
	const names = calledNames(build.compilation.keys.values(), [
		"markup",
		"message",
	]);
	const exports = keyExports(
		keys.map(([name, compiled]) => {
			const quoted = JSON.stringify(name);
			const value =
				compiled.kind === "markup"
					? `markup(live(${quoted}, "v"), live(${quoted}, "p"))`
					: `message(...live(${quoted}, "v"))`;
			return { name, value };
		}),
		new Set([...everyName(names), ...devWords]),
	);
	return `${outputImports(names, inOutdir(outdir))}
const T = {
${keys.map(([key, compiled]) => `\t${key}: ${row(compiled)},`).join("\n")}
};
${liveCode}${exports}${patchCode}`;
}

/**
 * What a dev import of a key no catalog has gets, by its path: an export that throws a GraiError
 * naming the key when it is called, so the page still loads. A failed import would stop the page,
 * and in SvelteKit look like a stale deployment, which reloads it.
 */
export function missingKeyModule(outdir: string, key: string): string {
	const message = `"${key}" is imported by its path, but no catalog has it. Add it to every catalog, or fix the import.`;
	return `import { GraiError } from ${JSON.stringify(join(outdir, "runtime.js"))};
const missing = () => {
	throw new GraiError("key-missing", ${JSON.stringify(message)});
};
missing.parts = missing;
export { missing as ${key} };
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
	return `${outputImports(calledNames(keys, []), inOutdir(outdir))}\nexport const rows = {\n${rows.join("\n")}\n};\n`;
}

/** A key's row in the dev table: its locales' variants, and their parts for markup. */
function row(compiled: CompiledKey | undefined): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup" ? `, p: [${compiled.parts.join(", ")}]` : "";
	return `{ v: [${compiled.variants.join(", ")}]${parts} }`;
}
