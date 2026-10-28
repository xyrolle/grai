import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import type { CompiledProject } from "./compile.ts";
import {
	changeEvent,
	patchedEvent,
	readHook,
	sinceEvent,
	updateEvent,
} from "./dev-events.ts";
import { destructuredExports } from "./key-exports.ts";
import { identifierKey } from "./literal-key.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";
import { everyLocale } from "./page-keys.ts";

/**
 * The dev module's table: its text keys' rows as one JSON string, and the other keys' rows. A
 * spread, not `Object.assign`, which would set a key named `__proto__` through the setter. The
 * JSON is in single quotes, which leave its own quotes as they are: about 28 KB less on the
 * synthetic catalog's page, for the dev server to send and the browser to read.
 */
const table = (textRows: string, callRows: string) =>
	`const T = {
	...JSON.parse('${singleQuoted(`{${textRows}}`)}'),
${callRows}
};
`;

/**
 * Text as a single-quoted string holds it: its `\` and `'` escaped. JSON has no raw line breaks,
 * and a string may hold U+2028 and U+2029 as they are.
 */
const singleQuoted = (text: string) =>
	text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

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
	build: CompiledProject,
	version: number,
	locale?: string,
): string {
	const { locales } = build.config;
	const slots =
		locale === undefined
			? locales.map((_, index) => index)
			: [locales.indexOf(locale)];
	const [slot] = slots;
	const held = (variants: readonly string[], separator: string) =>
		slots.length === 1 && slot !== undefined
			? (variants[slot] ?? "")
			: slots.map((each) => variants[each]).join(separator);
	const keys: string[] = [];
	const textRows: string[] = [];
	const callRows: string[] = [];
	for (const [key, compiled] of build.compilation.keys) {
		keys.push(key);
		if (compiled.kind === "text")
			textRows.push(
				`${JSON.stringify(key)}:{"v":[${held(compiled.variants, ",")}]}`,
			);
		else callRows.push(`\t${identifierKey(key)}: ${row(compiled, held)},`);
	}
	const names = calledNames(build.compilation.keys.values(), [
		"markup",
		"message",
	]);
	return `${outputImports(names, (file) => join(outdir, file), build.rendered.modules)}
${slotsCode(slots, locales.length)}${table(textRows.join(","), callRows.join("\n"))}${madeCode}${destructuredExports(
	"made",
	keys,
	new Set([...everyName(names), ...devWords]),
)}${patchCode(version)}`;
}

/**
 * The code of keys.js for the client. A page's import map points it at the page's locale's module,
 * and Vite still makes keys.js ahead of the page, as it makes every module a page's modules import:
 * it holds no words, so it costs little. Imported, it takes, from beside its own URL, the module
 * of the page's locale, by the page's `<html lang>`, as the runtime reads the locale; in a worker,
 * which no import map reaches and which has no `<html lang>`, the module of every locale's words,
 * as the runtime there renders in any. It exports their keys.
 */
const shellCode = (locales: readonly string[], baseLocale: string) =>
	`const locales = ${JSON.stringify(locales)};
const lang = globalThis.document?.documentElement.lang;
const url = new URL(import.meta.url);
url.pathname += \`/\${lang === undefined ? ${JSON.stringify(everyLocale)} : locales.includes(lang) ? lang : ${JSON.stringify(baseLocale)}}\`;
url.search = "";
const keys = await import(/* @vite-ignore */ url.href);
`;

/** Every word of the shell's own code, which a key's export takes no name of. */
const shellWords = new Set(shellCode([], "").match(/[A-Za-z_$][\w$]*/g));

/** keys.js for the client in dev (`shellCode`). */
export function pageKeysShell(build: CompiledProject): string {
	const { locales, baseLocale } = build.config;
	return `${shellCode(locales, baseLocale)}${destructuredExports(
		"keys",
		[...build.compilation.keys.keys()],
		shellWords,
	)}`;
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
	build: CompiledProject,
	changed: readonly string[],
): string {
	const keys = changed.flatMap((key) => build.compilation.keys.get(key) ?? []);
	const rows = changed.map(
		(key) =>
			`\t${identifierKey(key)}: ${row(build.compilation.keys.get(key), (variants, separator) => variants.join(separator))},`,
	);
	return `${outputImports(calledNames(keys, []), (file) => join(outdir, file), build.rendered.modules)}\nexport const rows = {\n${rows.join("\n")}\n};\n`;
}

/** A key's row in the dev table: the variants `held` keeps of its locales', and their parts for markup. */
function row(
	compiled: CompiledKey | undefined,
	held: (variants: readonly string[], separator: string) => string,
): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup" ? `, p: [${held(compiled.parts, ", ")}]` : "";
	return `{ v: [${held(compiled.variants, ", ")}]${parts} }`;
}
