import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import { pseudoPattern } from "../src/pseudo-text.ts";
import { errorsOf, project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

describe("a pseudo-locale", () => {
	it("accents each letter, grows the text by whole words, and brackets it, keeping its codes", () => {
		expect(pseudoPattern("Read the {#link}terms{/link}, {name} \\{x\\}")).toBe(
			"[Ŕéåð ţĥé {#link}ţéŕɱš{/link}, {name} \\{ẋ\\} one two]",
		);
		expect(pseudoPattern("OK")).toBe("[ÖĶ one]");
	});

	it("is compiled for development from the base, choosing as the base does", async () => {
		const { config } = project(
			{
				en: {
					...catalogs.en,
					items: [
						{
							declarations: [
								"input count",
								"local countPlural = count: plural",
							],
							selectors: ["countPlural"],
							match: {
								"countPlural=one": "{count} item",
								"countPlural=*": "{count} items",
							},
						},
					],
				},
				de: { ...catalogs.de, items: "{count} Artikel" },
			},
			{ pseudoLocale: "en-XA" },
		);

		const { build } = await recompile(config, undefined, {
			pseudoLocale: true,
		});

		expect(build?.config.locales).toEqual(["en", "de", "en-XA"]);
		expect(build?.compilation.keys.get("title")?.variants).toEqual([
			'"Title"',
			'"Titel"',
			'"[Ţîţļé one]"',
		]);
		expect(build?.compilation.keys.get("items")?.plurals).toEqual(
			new Set(["plural_en", "plural_en_XA"]),
		);
	});

	it("is made again only for the keys an edit of the base touched", async () => {
		const { dir, config } = project(catalogs, { pseudoLocale: "en-XA" });
		const first = await recompile(config, undefined, { pseudoLocale: true });
		writeFileSync(
			join(dir, "messages", "en.json"),
			JSON.stringify({ ...catalogs.en, title: "Heading" }, null, "\t"),
		);

		const { build } = await recompile(config, first.build, {
			pseudoLocale: true,
		});

		expect([...(build?.compilation.changed ?? [])]).toEqual(["title"]);
		expect(build?.compilation.keys.get("title")?.variants.at(-1)).toBe(
			'"[Ĥéåðîñĝ one]"',
		);
	});

	it("is left out of a compile for a build", async () => {
		const { dir, config } = project(catalogs, { pseudoLocale: "en-XA" });

		await recompile(config, undefined, { pseudoLocale: true });
		const { build } = await recompile(config, undefined);

		expect(build?.config.locales).toEqual(["en", "de"]);
		expect(readFileSync(join(dir, "out", "config.js"), "utf8")).not.toContain(
			"en-XA",
		);
	});

	it("must be a locale of its own, with the base's plural categories", async () => {
		expect(await errorsOf(catalogs, { pseudoLocale: "de" })).toEqual([
			'config-invalid: grai.config.json: "pseudoLocale" must be a BCP 47 language tag in its canonical form that "locales" does not list, such as "en-XA".',
		]);
		expect(await errorsOf(catalogs, { pseudoLocale: "ru-XA" })).toEqual([
			`config-invalid: grai.config.json: "pseudoLocale" takes its plurals from en, so it must have its cardinal categories, one, other, and ru-XA has one, few, many, other. Name it after en's language, such as "en-XA".`,
		]);
	});
});
