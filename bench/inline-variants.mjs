// The ways a page's messages can reach it in one locale, built from grai's own compiler model on
// an app's catalogs, for inline-page.mjs:
// - the Vite plugin's per-locale copy of a message chunk, every call through the dispatcher;
// - that copy collapsed: each key its locale's variant, behind a check that a forced `{ locale }`
//   is the page's;
// - bare variants, with no check at all;
// - calls inlined at their call sites: a text becomes its string, any other message a direct call
//   of its locale's arrow, hoisted into the calling module.
import { join } from "node:path";
import { parseSync, Visitor } from "rolldown/utils";
import { graiSource, writeGraiProject } from "./grai.mjs";

const { recompile } = await import(join(graiSource, "compile.ts"));
const { localeCopies } = await import(join(graiSource, "locale-chunks.ts"));
const { outputImports } = await import(join(graiSource, "output-imports.ts"));
const { pluralName } = await import(join(graiSource, "plurals.ts"));

/** The app compiled by grai into a project under .cache, with its output written. */
export async function compiledApp(app, name = "inline") {
	const { result, build } = await recompile(
		writeGraiProject(app, name),
		undefined,
	);
	if (build === undefined)
		throw new Error(result.errors.map((error) => error.message).join("\n"));
	return build;
}

const compiledKey = (build, key) => {
	const compiled = build.compilation.keys.get(key);
	if (compiled === undefined) throw new Error(`grai compiled no key ${key}`);
	return compiled;
};

/** A message chunk of `keys` as the plugin renders it, with every locale's variants. */
function messageChunk(build, keys) {
	const compiled = keys.map((key) => compiledKey(build, key));
	const uses = new Set(compiled.flatMap((key) => [...key.uses]));
	const declarations = compiled.map((key) =>
		key.code.replace(/^export const /, "const "),
	);
	return `${outputImports(build.config.outdir, compiled, uses)}\n${declarations.join("")}export { ${keys.join(", ")} };\n`;
}

/** The Vite plugin's per-locale copy of a message chunk holding `keys`. */
export function todayCopy(build, keys, locale) {
	const copy = localeCopies(
		"keys.js",
		messageChunk(build, keys),
		build.config.locales,
	).get(locale);
	if (copy === undefined) throw new Error(`no copy for ${locale}`);
	return copy;
}

/** The copy with each key reduced to its locale's variant, behind the check of a forced locale. */
export function collapsedCopy(build, keys, locale) {
	const index = build.config.locales.indexOf(locale);
	const outdir = build.config.outdir;
	const here = JSON.stringify(locale);
	const lines = [
		`import { GraiError } from ${JSON.stringify(join(outdir, "runtime.js"))};`,
		...localeImports(build, keys, locale),
		`const misplaced = (locale) => { throw new GraiError("locale-unknown", \`\${locale} is not this page's locale.\`); };`,
		`const one = (value) => (_inputs, options) => options?.locale === undefined || options.locale === ${here} ? value : misplaced(options.locale);`,
		`const oneOf = (variant) => (inputs, options) => options?.locale === undefined || options.locale === ${here} ? variant(inputs) : misplaced(options.locale);`,
	];
	for (const key of keys) {
		const compiled = compiledKey(build, key);
		const variant = compiled.variants[index];
		lines.push(
			compiled.kind === "text"
				? `const ${key} = /*#__PURE__*/ one(${variant});`
				: compiled.kind === "message"
					? `const ${key} = /*#__PURE__*/ oneOf(${variant});`
					: `const ${key} = /*#__PURE__*/ Object.assign(oneOf(${variant}), { parts: oneOf(${compiled.parts[index]}) });`,
		);
	}
	lines.push(`export { ${keys.join(", ")} };`);
	return `${lines.join("\n")}\n`;
}

/** The imports a locale's variants of `keys` need: its plural function, and `unmatched`. */
function localeImports(build, keys, locale) {
	const outdir = build.config.outdir;
	const index = build.config.locales.indexOf(locale);
	const variants = keys.flatMap((key) => {
		const compiled = compiledKey(build, key);
		return [compiled.variants[index], compiled.parts[index] ?? ""];
	});
	const imports = [];
	const plural = pluralName(locale);
	if (variants.some((variant) => variant.includes(`${plural}(`)))
		imports.push(
			`import { ${plural} } from ${JSON.stringify(join(outdir, "plurals.js"))};`,
		);
	if (variants.some((variant) => variant.includes("unmatched(")))
		imports.push(
			`import { unmatched } from ${JSON.stringify(join(outdir, "runtime.js"))};`,
		);
	return imports;
}

/**
 * Each key as its locale's bare variant: an arrow returning its string, or its locale's arrow. It
 * ignores a forced `{ locale }`, so it shows what the dispatcher and the check themselves cost.
 */
export function bareCopy(build, keys, locale) {
	const index = build.config.locales.indexOf(locale);
	const lines = [...localeImports(build, keys, locale)];
	for (const key of keys) {
		const compiled = compiledKey(build, key);
		const variant = compiled.variants[index];
		lines.push(
			compiled.kind === "text"
				? `const ${key} = () => ${variant};`
				: compiled.kind === "message"
					? `const ${key} = ${variant};`
					: `const ${key} = Object.assign(${variant}, { parts: ${compiled.parts[index]} });`,
		);
	}
	lines.push(`export { ${keys.join(", ")} };`);
	return `${lines.join("\n")}\n`;
}

/**
 * `code` with every call of a message (`keyOf`: its local name → its key) that passes at most one
 * argument, so forces no locale, replaced at its call site for `locale`. A text becomes its
 * string; any other message calls its locale's arrow, hoisted once into the module.
 */
export function inlineCalls(build, code, keyOf, locale) {
	const index = build.config.locales.indexOf(locale);
	const edits = [];
	const hoisted = new Map();
	new Visitor({
		CallExpression(call) {
			const callee = call.callee;
			if (callee.type !== "Identifier" || call.arguments.length > 1) return;
			const key = keyOf.get(callee.name);
			if (key === undefined) return;
			const compiled = compiledKey(build, key);
			const variant = compiled.variants[index];
			if (compiled.kind === "text") {
				edits.push({ start: call.start, end: call.end, text: variant });
				return;
			}
			hoisted.set(key, variant);
			edits.push({ start: callee.start, end: callee.end, text: `${key}$` });
		},
	}).visit(parseSync("page.js", code).program);
	let inlined = code;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		inlined =
			inlined.slice(0, edit.start) + edit.text + inlined.slice(edit.end);
	const arrows = [...hoisted].map(
		([key, variant]) => `const ${key}$ = ${variant};`,
	);
	return [
		...localeImports(build, [...hoisted.keys()], locale),
		inlined,
		...arrows,
		"",
	].join("\n");
}
