import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { seed } from "../src/seed.ts";
import { project } from "./project.ts";

const items = (match: Record<string, string>) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["countPlural"],
		match,
	},
];

const catalog = (dir: string, locale: string): unknown =>
	JSON.parse(readFileSync(join(dir, "messages", `${locale}.json`), "utf8"));

describe("grai seed", () => {
	it("gives a locale the base text of each key it lacks, after the keys it has, then compiles", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart", cart_empty: "Empty", cart_total: "Total" },
			de: { cart_total: "Summe" },
		});

		const seeded = await seed(config, "de");

		expect(seeded).toMatchObject({
			file: "messages/de.json",
			keys: 2,
			result: { errors: [] },
		});
		expect(Object.entries(catalog(dir, "de") as object)).toEqual([
			["cart_total", "Summe"],
			["cart_title", "Your cart"],
			["cart_empty", "Empty"],
		]);
	});

	it("seeds a plural so that it covers the categories of the locale, not only the base locale's", async () => {
		const { dir, config, load } = project({
			en: {
				cart_items: items({
					"countPlural=one": "{count} item",
					"countPlural=other": "{count} items",
				}),
			},
			ru: {},
		});

		await seed(config, "ru");
		const { m } = await load();

		expect(catalog(dir, "ru")).toEqual({
			cart_items: items({
				"countPlural=one": "{count} item",
				"countPlural=*": "{count} items",
			}),
		});
		expect(m.cart_items?.({ count: 3 }, { locale: "ru" })).toBe("3 items");
	});

	it("creates the catalog of a locale that has none, in the base catalog's layout", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart" },
			fr: {},
		});
		const base = join(dir, "messages", "en.json");
		writeFileSync(
			base,
			'{\n  "$schema": "https://inlang.com/schema/inlang-message-format",\n  "cart_title": "Your cart"\n}\n',
		);
		rmSync(join(dir, "messages", "fr.json"));

		expect(await seed(config, "fr")).toMatchObject({
			keys: 1,
			result: { errors: [] },
		});
		expect(readFileSync(join(dir, "messages", "fr.json"), "utf8")).toBe(
			readFileSync(base, "utf8"),
		);
	});

	it("seeds no base locale and no locale the config lacks", async () => {
		const { config } = project({ en: { cart_title: "Your cart" }, de: {} });

		for (const locale of ["en", "fr"]) {
			expect(await seed(config, locale)).toEqual({
				errors: [
					expect.objectContaining({
						code: "config-invalid",
						message: `grai.config.json: "${locale}" is not a locale to seed. Seed one of de, from the base locale en.`,
					}),
				],
			});
		}
	});
});

describe("grai check's untranslated keys", () => {
	it("lists each key whose message is still its seed, in each locale but the base, and no problem for it", async () => {
		const { config } = project({
			en: {
				cart_title: "Your cart",
				cart_total: "Total",
				cart_items: items({
					"countPlural=one": "{count} item",
					"countPlural=other": "{count} items",
				}),
			},
			de: {
				cart_title: "Your cart",
				cart_total: "Summe",
				cart_items: items({
					"countPlural=one": "{count} Artikel",
					"countPlural=other": "{count} Artikel",
				}),
			},
			ru: {
				cart_title: "Корзина",
				cart_total: "Итого",
				cart_items: items({
					"countPlural=one": "{count} item",
					"countPlural=*": "{count} items",
				}),
			},
		});

		const { problems, untranslated } = await check(config);

		expect(problems.map((problem) => problem.code)).toEqual([
			"key-unused",
			"key-unused",
			"key-unused",
		]);
		expect([...untranslated]).toEqual([
			["de", ["cart_title"]],
			["ru", ["cart_items"]],
		]);
	});
});
