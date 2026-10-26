import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectCode } from "../src/code/project.ts";
import { type Place, readingOf } from "../src/code/reads.ts";
import { readConfig } from "../src/config.ts";
import { GraiError } from "../src/error.ts";
import { project } from "./project.ts";
import { i18nTs, writeSources } from "./sources.ts";

/** Each read and reach of a project's code, written short: file, line:column, what, and its keys. */
async function readsOf(files: Record<string, string>): Promise<string[]> {
	const { dir, config, compile } = project({
		en: { title: "Title", subtitle: "Subtitle", promo_a: "A", promo_b: "B" },
	});
	await compile();
	writeSources(dir, files);
	const code = await readProjectCode(readConfig(config), [join(dir, "src")]);
	if (code instanceof GraiError) throw code;
	const { reads, reaches } = await readingOf(code);
	const place = ({ source, at }: Place) => {
		const before = source.text.slice(0, at.start).split("\n");
		return `${source.file}:${before.length}:${(before.at(-1)?.length ?? 0) + 1}`;
	};
	return [
		...reads.map((read) => `${place(read)} ${read.via} ${read.key}`),
		...reaches.map(
			(reach) =>
				`${place(reach)} may reach ${reach.choices?.join("|") ?? `${reach.prefix}*`}: ${reach.written}`,
		),
	];
}

describe("the reads of a project's code", () => {
	it("follows the namespace through a barrel, a star export, a const and a module object", async () => {
		expect(
			await readsOf({
				"src/lib/i18n.ts": i18nTs,
				"src/lib/index.ts": 'export * from "./i18n.ts";\n',
				"src/a.ts": [
					'import { m } from "./lib/index.ts";',
					'import * as lib from "./lib/i18n.ts";',
					"const t = m;",
					't.title(); lib.m["subtitle"]();',
					"",
				].join("\n"),
			}),
		).toEqual(["src/a.ts:4:3 member title", "src/a.ts:4:19 member subtitle"]);
	});

	it("reads a key's path once, however its module is then read", async () => {
		expect(
			await readsOf({
				"src/a.ts": [
					'import { title } from "#i18n/messages/title.js";',
					'const { subtitle } = await import("#i18n/messages/subtitle.js");',
					'const promo = await import("#i18n/messages/promo_a.js");',
					"title(); subtitle(); promo.promo_a();",
					"",
				].join("\n"),
			}),
		).toEqual([
			"src/a.ts:1:39 path title",
			"src/a.ts:2:51 path subtitle",
			"src/a.ts:3:44 path promo_a",
		]);
	});

	it("reaches what a computed read, a whole use or a template load may name, and no more", async () => {
		expect(
			await readsOf({
				"src/lib/i18n.ts": i18nTs,
				"src/lib/format.ts": "export const money = (n: number) => String(n);\n",
				"src/a.ts": [
					'import { m } from "./lib/i18n.ts";',
					'import * as format from "./lib/format.ts";',
					'import * as keys from "../out/keys.js";',
					"export const pick = (season: string, on: boolean) => [",
					`\tm[\`promo_\${season}\`], m[on ? 'title' : 'subtitle'], keys[season],`,
					"];",
					"export const all = [format, Object.keys(m)];",
					`export const load = (name: string) => import(\`#i18n/messages/promo_\${name}.js\`);`,
					"",
				].join("\n"),
			}),
		).toEqual([
			`src/a.ts:8:39 may reach promo_*: import(\`#i18n/messages/promo_\${name}.js\`)`,
			`src/a.ts:5:2 may reach promo_*: m[\`promo_\${season}\`]`,
			"src/a.ts:5:24 may reach title|subtitle: m[on ? 'title' : 'subtitle']",
			"src/a.ts:7:41 may reach *: m",
			"src/a.ts:5:54 may reach *: keys[season]",
		]);
	});

	it("reads what a dynamic import loads after one by a name, which loads nothing it can follow", async () => {
		expect(
			await readsOf({
				"src/lib/i18n.ts": i18nTs,
				"src/a.ts": [
					'const path = "./b.ts";',
					"const other = await import(path);",
					'const i18n = await import("./lib/i18n.ts");',
					"other.run(); i18n.m.title();",
					"",
				].join("\n"),
			}),
		).toEqual(["src/a.ts:4:21 member title"]);
	});

	it("takes a module a dynamic import hands to then as used whole, and a key's own module as its path", async () => {
		expect(
			await readsOf({
				"src/lib/i18n.ts": i18nTs,
				"src/lib/format.ts": "export const money = (n: number) => String(n);\n",
				"src/a.ts": [
					'import("./lib/i18n.ts").then(({ m }) => m.title());',
					'import("./lib/format.ts").then(({ money }) => money(1));',
					'import("#i18n/messages/subtitle.js").then((module) => module.subtitle());',
					"",
				].join("\n"),
			}),
		).toEqual([
			"src/a.ts:3:24 path subtitle",
			'src/a.ts:1:1 may reach *: import("./lib/i18n.ts").then',
		]);
	});
});
