import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import {
	changeEvent,
	patchedEvent,
	readHook,
	sinceEvent,
	updateEvent,
} from "./dev-events.ts";
import { freshName } from "./key-exports.ts";
import { identifierKey } from "./literal-key.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";

/**
 * The dev module's table: its text keys' rows as one JSON string, and the other keys' rows. A
 * spread, not `Object.assign`, which would set a key named `__proto__` through the setter.
 */
const table = (textRows: string, callRows: string) =>
	`const T = {
	...JSON.parse(${JSON.stringify(`{${textRows}}`)}),
${callRows}
};
`;

/**
 * The positions in the config's `locales` whose variants the table's rows hold, in order, and how
 * many locales there are: every locale's for a server, the page's alone for a page.
 */
const slotsCode = (slots: readonly number[], count: number) =>
	`const slots = ${JSON.stringify(slots)};
const count = ${count};
`;

/**
 * The dev module's code after its table: the hook a call names its key to, each key's live
 * variants, one per locale, none for a locale the table does not hold, and each key's message made
 * from them, and how a patch's row, which holds every locale, is taken into the table. The
 * messages are made in a function of their own: V8 compiles a function whose loop runs long, and
 * with the loop over every key in the module's top level, it compiled the whole top level, which a
 * page then kept, 2.4 MB on a catalog of 13,326 keys in three locales.
 */
const madeCode = `const read = Symbol.for(${JSON.stringify(readHook)});
const live = (key, field) => [...Array.from({ length: count }, (_, n) => {
	const at = slots.indexOf(n);
	return at === -1 ? undefined : (inputs) => {
		globalThis[read]?.(key);
		const variant = T[key][field][at];
		return typeof variant === "function" ? variant(inputs) : variant;
	};
}), key];
const taken = (row) => ({ v: slots.map((n) => row.v[n]), ...(row.p === undefined ? {} : { p: slots.map((n) => row.p[n]) }) });
const made = (() => {
	const made = Object.create(null);
	for (const key in T) made[key] = T[key].p === undefined ? message(...live(key, "v")) : markup(live(key, "v"), live(key, "p"));
	return made;
})();
`;

/**
 * The dev module's handler of an edit's patch, which writes it into the table. The table's version
 * is how many patches it has, from the server's count when it served the module. The module asks
 * for the patches sent before it was evaluated, which reached no handler, and writes each patch in
 * turn: one it has, or one that comes ahead of those it asked for, it leaves, as the server sends
 * it again. Vite hands a module its events one at a time, so each is written before the next.
 */
const patchCode = (version: number) => `if (import.meta.hot) {
	let version = ${version};
	import.meta.hot.on(${JSON.stringify(updateEvent)}, async (patch) => {
		if (patch.version !== version) return;
		version += 1;
		const { rows } = await import(/* @vite-ignore */ patch.url);
		for (const [key, row] of Object.entries(rows)) Object.assign(T[key], taken(row));
		if (typeof window === "undefined") return import.meta.hot.send(${JSON.stringify(patchedEvent)});
		const detail = { keys: Object.keys(rows) };
		if (window.dispatchEvent(new CustomEvent(${JSON.stringify(changeEvent)}, { cancelable: true, detail }))) location.reload();
	});
	import.meta.hot.send(${JSON.stringify(sinceEvent)}, { version });
}
`;

/**
 * Every word of the dev module's own code, as written: each name it binds or calls, `T`, `made`,
 * `Object` or `location`, and some it need not, so that a key named like any of them binds a name
 * of its own.
 */
const devWords = new Set(
	`${slotsCode([], 0)}${table("", "")}${madeCode}${patchCode(0)}`.match(
		/[A-Za-z_$][\w$]*/g,
	),
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
 * written the patch. `version` is how many patches the server has made, every one of which the
 * build has. Each key passes its name after its variants, one for each of the config's locales,
 * for the runtime's errors to name. A build leaves names out: they would add about a third to a
 * page's gzipped message bytes.
 *
 * With `locale`, the module is a page's in that locale: its table holds that locale's variants
 * alone, and each key's other variants are none, which the runtime refuses to call, as a page
 * renders in its locale alone. A server's module holds every locale's.
 */
export function devModule(
	outdir: string,
	build: Build,
	version: number,
	locale?: string,
): string {
	const { locales } = build.config;
	const slots =
		locale === undefined
			? locales.map((_, index) => index)
			: [locales.indexOf(locale)];
	const held = (variants: readonly string[]) =>
		slots.map((slot) => variants[slot]);
	const keys = [...build.compilation.keys];
	const texts = keys.filter(([, compiled]) => compiled.kind === "text");
	const calls = keys.filter(([, compiled]) => compiled.kind !== "text");
	const textRows = texts
		.map(
			([key, compiled]) =>
				`${JSON.stringify(key)}:{"v":[${held(compiled.variants).join(",")}]}`,
		)
		.join(",");
	const names = calledNames(build.compilation.keys.values(), [
		"markup",
		"message",
	]);
	const callRows = calls
		.map(
			([key, compiled]) => `\t${identifierKey(key)}: ${row(compiled, held)},`,
		)
		.join("\n");
	return `${outputImports(names, (file) => join(outdir, file), build.rendered.modules)}
${slotsCode(slots, locales.length)}${table(textRows, callRows)}${madeCode}${madeExports(
	keys.map(([key]) => key),
	new Set([...everyName(names), ...devWords]),
)}${patchCode(version)}`;
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
		(key) =>
			`\t${identifierKey(key)}: ${row(build.compilation.keys.get(key), (variants) => variants)},`,
	);
	return `${outputImports(calledNames(keys, []), (file) => join(outdir, file), build.rendered.modules)}\nexport const rows = {\n${rows.join("\n")}\n};\n`;
}

/** A key's row in the dev table: the variants `held` keeps of its locales', and their parts for markup. */
function row(
	compiled: CompiledKey | undefined,
	held: (variants: readonly string[]) => readonly (string | undefined)[],
): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup"
			? `, p: [${held(compiled.parts).join(", ")}]`
			: "";
	return `{ v: [${held(compiled.variants).join(", ")}]${parts} }`;
}
