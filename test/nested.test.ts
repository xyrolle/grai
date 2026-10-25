import { describe, expect, it } from "vitest";
import { keyPositions } from "../src/declaration-maps.ts";
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
