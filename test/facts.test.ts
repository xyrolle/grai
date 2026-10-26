import { describe, expect, it } from "vitest";
import { factsOf, type ModuleFacts, type UseFact } from "../src/code/facts.ts";

async function moduleOf(path: string, text: string): Promise<ModuleFacts> {
	const facts = await factsOf(path, text);
	if ("error" in facts) throw new Error(facts.error.message);
	const [module] = facts.modules;
	if (module === undefined) throw new Error("no module");
	return module;
}

/**
 * Each use, written short: where it comes from, the names it reads (each where its name is, then
 * the expression that reads it), and how it ends, with the text of a computed read or a rest.
 */
function short(text: string, uses: readonly UseFact[]): string[] {
	const of = ({ start, end }: { start: number; end: number }) =>
		text.slice(start, end);
	return uses.map(({ from, chain, end, type }) => {
		const source = "local" in from ? from.local : `load ${from.load}`;
		const names = chain.map(
			({ name, at, expression }) => `${name}@${of(at)}<${of(expression)}>`,
		);
		const ending =
			end.kind === "computed"
				? `computed ${JSON.stringify(end.prefix)}${end.choices === undefined ? "" : ` ${end.choices.join("|")}`} <${of(end.at)}>`
				: end.kind === "pattern"
					? `pattern ${end.names.map(({ name, binds }) => `${name}${binds === undefined ? "" : `>${binds.name}x${binds.references.length}`}`).join(",")}${end.rest === undefined ? "" : ` <${of(end.rest)}>`}`
					: end.kind;
		return [source, ...names, ending, ...(type ? ["type"] : [])].join(" ");
	});
}

describe("a file's facts", () => {
	it("reads each use of an import: the names read from it, then how it ends", async () => {
		const text = [
			'import { m } from "./i18n";',
			"m.title();",
			'm["sub_title"]; m?.optional; (m as typeof m).cast;',
			`m[\`promo_\${season}\`]; m["a_" + b]; m[flag ? "yes" : "no"]; m[name];`,
			'const { heading, "key_two": two, [`x`]: three, ...rest } = m;',
			"heading(); heading();",
			"const t = m; t.aliased(); export { t };",
			"show(m); export default m;",
			"type Title = typeof m.typed;",
		].join("\n");
		const module = await moduleOf("src/a.ts", text);

		expect(short(text, module.uses)).toEqual([
			"m title@title<m.title> value",
			'm sub_title@sub_title<m["sub_title"]> value',
			"m optional@optional<m?.optional> value",
			"m cast@cast<(m as typeof m).cast> value",
			"m value type",
			`m computed "promo_" <m[\`promo_\${season}\`]>`,
			'm computed "a_" <m["a_" + b]>',
			'm computed "" yes|no <m[flag ? "yes" : "no"]>',
			'm computed "" <m[name]>',
			"m pattern heading>headingx2,key_two>twox0,x>threex0 <...rest>",
			"m aliased@aliased<t.aliased> value",
			"m export",
			"m value",
			"m export",
			"m typed@typed<m.typed> value type",
		]);
		expect(module.aliases).toEqual({ t: "m" });
	});

	it("reads imports, exports, and loads by a literal path, a template or a glob", async () => {
		const text = [
			'import { a, b as c } from "./one";',
			'import * as ns from "./two";',
			'import type { T } from "./types";',
			'export { m as t } from "./i18n";',
			'export * from "./three";',
			'export * as four from "./four";',
			"export { a, c as d };",
			"export const e = a;",
			"export default c;",
			'const { title } = await import("#i18n/messages/title.js");',
			'const all = import.meta.glob("./messages/*.js");',
			`const lazy = (key) => import(\`#i18n/messages/\${key}.js\`);`,
			'const node = require("./five");',
			"const dynamic = (path) => import(path);",
		].join("\n");
		const module = await moduleOf("src/a.ts", text);

		expect(
			module.imports.map(({ source, names, typeOnly }) =>
				[
					source,
					...names.map(({ imported, local }) => `${imported}>${local}`),
					...(typeOnly ? ["type"] : []),
				].join(" "),
			),
		).toEqual([
			"./one a>a b>c",
			"./two *>ns",
			"./types T>T type",
			"./i18n",
			"./three",
			"./four",
			"#i18n/messages/title.js",
			"./five",
		]);
		expect(module.exports).toEqual([
			{ exported: "t", source: "./i18n", imported: "m" },
			{ exported: undefined, source: "./three", imported: "*" },
			{ exported: "four", source: "./four", imported: "*" },
			{ exported: "a", local: "a" },
			{ exported: "d", local: "c" },
			{ exported: "e", local: "e" },
			{ exported: "default", local: "c" },
		]);
		expect(
			module.loads.map((load) =>
				"source" in load ? load.source : load.pattern,
			),
		).toEqual([
			"#i18n/messages/title.js",
			"./messages/*.js",
			"#i18n/messages/*.js",
			"./five",
		]);
		expect(module.aliases).toEqual({ e: "a" });
	});

	it("reads a component's facts at the places in its file", async () => {
		const text = `<script>\n\timport { m } from "$lib/i18n";\n</script>\n{#each rows as m}{m.cell}{/each}<p>{m.title()}</p>\n`;
		const module = await moduleOf("src/App.svelte", text);

		expect(short(text, module.uses)).toEqual(["m title@title<m.title> value"]);
	});

	it("records how a use written in shorthand is written out in full around another name", async () => {
		const written = async (path: string, text: string) => {
			const module = await moduleOf(path, text);
			return module.uses.map(({ at, shorthand }) =>
				shorthand === undefined
					? text.slice(at.start, at.end)
					: `${text.slice(shorthand.replaces.start, shorthand.replaces.end)} => ${shorthand.before}x${shorthand.after}`,
			);
		};
		const imported = 'import { title, tooltip } from "./i18n";';

		expect(
			await written(
				"src/A.svelte",
				`<script>${imported}</script>\n<C {title} /><C bind:title /><p class:title style:title use:tooltip>{title}</p>\n`,
			),
		).toEqual([
			"{title} => title={x}",
			"bind:title => bind:title={x}",
			"class:title => class:title={x}",
			"style:title => style:title={x}",
			"title",
			"tooltip",
		]);
		expect(
			await written(
				"src/A.vue",
				`<script setup>${imported}</script>\n<template><C :title v-bind:tooltip :label="title" /></template>\n`,
			),
		).toEqual([
			':title => :title="x"',
			"title",
			'v-bind:tooltip => v-bind:tooltip="x"',
		]);
		expect(
			await written(
				"src/a.astro",
				`---\n${imported}\n---\n<C {title} label={tooltip} />\n`,
			),
		).toEqual(["{title} => title={x}", "tooltip"]);
		expect(
			await written(
				"src/a.ts",
				`${imported}\nexport const o = { title, tooltip: tooltip };\n`,
			),
		).toEqual(["title => title: x", "tooltip"]);
	});

	it("is a file's error where it does not parse", async () => {
		expect(await factsOf("src/a.ts", "const = 1;")).toEqual({
			error: { at: 6, message: "Unexpected token" },
		});
	});
});
