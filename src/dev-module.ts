import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import {
	changeEvent,
	patchedEvent,
	readHook,
	updateEvent,
} from "./dev-events.ts";
import { freshName } from "./key-exports.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";

/** The dev module's table: its text keys' rows as one JSON string, and the other keys' rows. */
const table = (textRows: string, callRows: string) =>
	`const T = Object.assign(JSON.parse(${JSON.stringify(`{${textRows}}`)}), {
${callRows}
});
`;

/**
 * The dev module's code after its table: the hook a call names its key to, each key's live
 * variants, and each key's message made from them.
 */
const madeCode = `const read = Symbol.for(${JSON.stringify(readHook)});
const live = (key, field) => [...T[key][field].map((_, n) => (inputs) => {
	globalThis[read]?.(key);
	const variant = T[key][field][n];
	return typeof variant === "function" ? variant(inputs) : variant;
}), key];
const made = {};
for (const key in T) made[key] = T[key].p === undefined ? message(...live(key, "v")) : markup(live(key, "v"), live(key, "p"));
`;

/** The dev module's handler of an edit's patch, which writes it into the table. */
const patchCode = `if (import.meta.hot) {
	import.meta.hot.on(${JSON.stringify(updateEvent)}, async ({ url }) => {
		const { rows } = await import(/* @vite-ignore */ url);
		for (const [key, row] of Object.entries(rows)) Object.assign(T[key], row);
		if (typeof window === "undefined") return import.meta.hot.send(${JSON.stringify(patchedEvent)});
		const detail = { keys: Object.keys(rows) };
		if (window.dispatchEvent(new CustomEvent(${JSON.stringify(changeEvent)}, { cancelable: true, detail }))) location.reload();
	});
}
`;

/**
 * Every word of the dev module's own code, as written: each name it binds or calls, `T`, `made`,
 * `Object` or `location`, and some it need not, so that a key named like any of them binds a name
 * of its own.
 */
const devWords = new Set(
	`${table("", "")}${madeCode}${patchCode}`.match(/[A-Za-z_$][\w$]*/g),
);

/**
 * The keys' exports, each destructured from `made` under its own name, unless the module's code
 * takes that name: such a key is destructured under a name of its own, `$` and the key, and
 * exported under the key.
 */
function madeExports(keys: readonly string[], taken: ReadonlySet<string>) {
	const own = keys.filter((key) => !taken.has(key));
	const exports = [`export const { ${own.join(", ")} } = made;\n`];
	const bound = new Set([...taken, ...keys]);
	const renamed = keys
		.filter((key) => taken.has(key))
		.map((key) => {
			const name = freshName(`$${key}`, bound);
			bound.add(name);
			return { key, name };
		});
	if (renamed.length > 0)
		exports.push(
			`const { ${renamed.map(({ key, name }) => `${key}: ${name}`).join(", ")} } = made;\n`,
			`export { ${renamed.map(({ key, name }) => `${name} as ${key}`).join(", ")} };\n`,
		);
	return exports.join("");
}

/**
 * keys.js in dev: every key, with its locales in a table, and the handler that writes an edit's
 * patch into the table, in the page and in a server's module runner alike. After a patch the page
 * dispatches a cancelable `grai:change` on `window`, its `detail.keys` the edited keys: a
 * framework adapter that renders them again cancels it, and otherwise the page reloads. Each call
 * first passes its key to `globalThis[Symbol.for("grai.read")]`, if an adapter set it, so the
 * adapter knows which renders read which keys. A server's runner sends `grai:patched` once it has
 * written the patch. Each key passes its name after its variants, for the runtime's errors to
 * name. A build leaves names out: they would add about a third to a page's gzipped message bytes.
 */
export function devModule(outdir: string, build: Build): string {
	const keys = [...build.compilation.keys];
	const texts = keys.filter(([, compiled]) => compiled.kind === "text");
	const calls = keys.filter(([, compiled]) => compiled.kind !== "text");
	const textRows = texts
		.map(
			([key, compiled]) =>
				`${JSON.stringify(key)}:{"v":[${compiled.variants.join(",")}]}`,
		)
		.join(",");
	const names = calledNames(build.compilation.keys.values(), [
		"markup",
		"message",
	]);
	const callRows = calls
		.map(([key, compiled]) => `\t${key}: ${row(compiled)},`)
		.join("\n");
	return `${outputImports(names, (file) => join(outdir, file), build.rendered.modules)}
${table(textRows, callRows)}${madeCode}${madeExports(
	keys.map(([key]) => key),
	new Set([...everyName(names), ...devWords]),
)}${patchCode}`;
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
	return `${outputImports(calledNames(keys, []), (file) => join(outdir, file), build.rendered.modules)}\nexport const rows = {\n${rows.join("\n")}\n};\n`;
}

/** A key's row in the dev table: its locales' variants, and their parts for markup. */
function row(compiled: CompiledKey | undefined): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup" ? `, p: [${compiled.parts.join(", ")}]` : "";
	return `{ v: [${compiled.variants.join(", ")}]${parts} }`;
}
