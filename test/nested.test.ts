import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { add } from "../src/add.ts";
import { keyPositions } from "../src/declaration-maps.ts";
import { seed } from "../src/seed.ts";
import { exportLocale, mergeDocument } from "../src/translations.ts";
import { errorsOf, project } from "./project.ts";

const catalogs = {
	en: {
		cart: { title: "Your cart", summary: { total: "{count} items" } },
		footer: "Footer",
	},
	de: {
		cart: { title: "Ihr Warenkorb", summary: { total: "{count} Artikel" } },
		footer: "Fußzeile",
	},
};

const catalog = (dir: string, locale: string): string =>
	readFileSync(join(dir, "messages", `${locale}.json`), "utf8");

describe("a catalog with objects of messages", () => {
	it("compiles each message under its path's names joined by _", async () => {
		const { m } = await project(catalogs).load();

		expect(m.cart_title?.()).toBe("Your cart");
		expect(m.cart_summary_total?.({ count: 3 }, { locale: "de" })).toBe(
			"3 Artikel",
		);
		expect(m.footer?.()).toBe("Footer");
	});

	it("is an error for two paths that name one key, a message with variants not in an array, or a name no key can have", async () => {
		expect(
			await errorsOf({
				en: { cart: { title: "A" }, cart_title: "B" },
			}),
		).toEqual([
			'key-invalid: messages/en.json: "cart_title" (en): cart.title and cart_title both name the key cart_title, as nested keys are joined by _. Rename one.',
		]);
		expect(
			await errorsOf({
				en: {
					items: { selectors: ["n"], match: { "n=*": "{n}" } },
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "items" (en): items is a message with variants, which the format writes as an array of one object. Wrap it in [ ].',
		]);
		expect(await errorsOf({ en: { cart: { "item-count": "x" } } })).toEqual([
			'key-invalid: messages/en.json: "cart_item-count": cart.item-count joins to this key by _, and a key must be a JavaScript identifier and not a reserved word, as it is the message\'s export name. Use letters, digits, _ and $.',
		]);
	});

	it("puts a declaration's definition at the key's own name in the base catalog", () => {
		const text = JSON.stringify(catalogs.en, null, "\t");

		expect(
			Object.fromEntries(
				keyPositions(
					text,
					["cart_title", "cart_summary_total", "footer"],
					true,
				),
			),
		).toEqual({
			cart: [1, 2],
			cart_title: [2, 3],
			cart_summary_total: [4, 4],
			footer: [7, 2],
		});
	});
});

describe("the commands in a catalog with objects of messages", () => {
	it("add a key to the object whose key starts it, and seed a locale in the base catalog's layout", async () => {
		const { dir, config } = project({ ...catalogs, fr: { footer: "Pied" } });

		const added = await add(config, "cart_summary_tax", {
			en: "Tax",
			de: "Steuer",
			fr: "Taxe",
		});
		const seeded = await seed(config, "fr");

		// The add's compile reports what fr lacks, which the seed then gives it.
		expect(added.errors.map(({ code }) => code)).toEqual([
			"key-missing",
			"key-missing",
		]);
		expect(JSON.parse(catalog(dir, "de")).cart.summary).toEqual({
			total: "{count} Artikel",
			tax: "Steuer",
		});
		expect("errors" in seeded ? seeded.errors : seeded.result.errors).toEqual(
			[],
		);
		expect(catalog(dir, "fr")).toBe(
			JSON.stringify(
				{
					footer: "Pied",
					cart: {
						summary: { tax: "Taxe", total: "{count} items" },
						title: "Your cart",
					},
				},
				null,
				"\t",
			),
		);
	});

	it("merge a translation into the message's place in the locale's object", async () => {
		const { dir, config } = project({ en: catalogs.en, de: catalogs.en });
		const exported = await exportLocale(config, "de", {
			json: false,
			untranslated: false,
		});
		const file = join(dir, "de.xlf");
		writeFileSync(
			file,
			("document" in exported ? exported.document : "").replace(
				/(<unit id="cart_title"[\s\S]*?<\/source>)/,
				"$1<target>Ihr Warenkorb</target>",
			),
		);

		const merged = await mergeDocument(config, file);

		expect("errors" in merged ? merged.errors : merged.result.errors).toEqual(
			[],
		);
		expect(JSON.parse(catalog(dir, "de")).cart.title).toBe("Ihr Warenkorb");
	});
});
