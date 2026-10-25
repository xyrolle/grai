import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { seed } from "../src/seed.ts";
import { project } from "./project.ts";
import { handLaid, schemaEntry } from "./sources.ts";

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

	it("gives a catalog the keys it lacks in its own layout, leaving its entries' bytes as they are", async () => {
		const { dir, config } = project({
			en: {
				cart_title: "Your cart",
				cart_items: items({
					"countPlural=one": "{count} item",
					"countPlural=*": "{count} items",
				}),
			},
			de: { cart_title: "Ihr Warenkorb" },
		});
		const own = [schemaEntry, '"cart_title":"Ihr Warenkorb \\u00e9"'];
		writeFileSync(join(dir, "messages", "de.json"), handLaid(...own));

		await seed(config, "de");

		const seededItems = `"cart_items": [
    {
      "declarations": [
        "input count",
        "local countPlural = count: plural"
      ],
      "selectors": [
        "countPlural"
      ],
      "match": {
        "countPlural=one": "{count} item",
        "countPlural=*": "{count} items"
      }
    }
  ]`.replaceAll("\n", "\r\n");
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(
			handLaid(...own, seededItems),
		);
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

	it("covers the locale's categories in each branch of another selector, whatever another branch's *", async () => {
		const gendered = (match: Record<string, string>) => [
			{
				declarations: [
					"input gender",
					"input count",
					"local countPlural = count: plural",
				],
				selectors: ["gender", "countPlural"],
				match,
			},
		];
		const { dir, config, load } = project({
			en: {
				invited: gendered({
					"gender=male,countPlural=*": "He invited {count}",
					"gender=female,countPlural=one": "She invited {count} guest",
					"gender=female,countPlural=other": "She invited {count} guests",
				}),
			},
			ru: {},
		});

		const seeded = await seed(config, "ru");
		const { m } = await load();

		expect(seeded).toMatchObject({ result: { errors: [] } });
		expect(catalog(dir, "ru")).toEqual({
			invited: gendered({
				"gender=male,countPlural=*": "He invited {count}",
				"gender=female,countPlural=one": "She invited {count} guest",
				"gender=female,countPlural=*": "She invited {count} guests",
			}),
		});
		expect(m.invited?.({ gender: "female", count: 3 }, { locale: "ru" })).toBe(
			"She invited 3 guests",
		);
	});

	it("seeds an ordinal with the variants of the locale's ordinal categories", async () => {
		const place = (match: Record<string, string>) => [
			{
				declarations: ["input n", "local nOrdinal = n: plural type=ordinal"],
				selectors: ["nOrdinal"],
				match,
			},
		];
		const { dir, config, load } = project({
			en: {
				place: place({
					"nOrdinal=one": "{n}st",
					"nOrdinal=two": "{n}nd",
					"nOrdinal=few": "{n}rd",
					"nOrdinal=other": "{n}th",
				}),
			},
			ru: {},
		});

		await seed(config, "ru");
		const { m } = await load();

		expect(catalog(dir, "ru")).toEqual({
			place: place({ "nOrdinal=*": "{n}th" }),
		});
		expect(m.place?.({ n: 21 }, { locale: "ru" })).toBe("21th");
	});

	it("seeds a number selector with its exact keys, and the variants of the locale's categories", async () => {
		const files = (match: Record<string, string>) => [
			{
				declarations: ["input count", "local n = count: number select=ordinal"],
				selectors: ["n"],
				match,
			},
		];
		const { dir, config, load } = project({
			en: {
				files: files({
					"n=1": "first",
					"n=one": "{n}st",
					"n=two": "{n}nd",
					"n=few": "{n}rd",
					"n=other": "{n}th",
				}),
			},
			ru: {},
		});

		await seed(config, "ru");
		const { m } = await load();

		expect(catalog(dir, "ru")).toEqual({
			files: files({ "n=1": "first", "n=*": "{n}th" }),
		});
		expect(m.files?.({ count: 2 }, { locale: "ru" })).toBe("2th");
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
						message: `grai.config.json: "${locale}" is not a locale to seed: name one of de; en is the base locale.`,
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

	it("leaves out the keys identicalToBase lists for the locale, as their message is the base text on purpose", async () => {
		const { config } = project(
			{
				en: { unit_km: "km", cart_title: "Your cart" },
				de: { unit_km: "km", cart_title: "Your cart" },
				ro: { unit_km: "km", cart_title: "Your cart" },
			},
			{ identicalToBase: { de: ["unit_km"] } },
		);

		const { untranslated } = await check(config);

		expect([...untranslated]).toEqual([
			["de", ["cart_title"]],
			["ro", ["unit_km", "cart_title"]],
		]);
	});

	it("is an error for a key identicalToBase lists that no catalog has, or whose message is translated now", async () => {
		const { config } = project(
			{
				en: { unit_km: "km", hotel: "Hotel" },
				ro: { unit_km: "km", hotel: "Hotelul" },
			},
			{ identicalToBase: { ro: ["unit_km", "hotel", "unit_mph"] } },
		);

		const { problems } = await check(config);

		expect(
			problems
				.filter((problem) => problem.code === "identical-stale")
				.map((problem) => problem.message),
		).toEqual([
			'grai.config.json: "hotel" (ro): "identicalToBase" lists the key, but its message is not en\'s any more. Remove it from the list.',
			'grai.config.json: "unit_mph" (ro): "identicalToBase" lists the key, which no catalog has. Remove it from the list.',
		]);
	});
});
