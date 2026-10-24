import { describe, expect, it } from "vitest";
import { find, foundLines } from "../src/find.ts";
import { project } from "./project.ts";
import { cartSvelte, headerTsx, i18nTs, writeSources } from "./sources.ts";

const catalogs = {
	en: { cart_title: "Your cart", cart_total: "{count} items" },
	de: { cart_title: "Ihr Warenkorb", cart_total: "{count} Artikel" },
};

describe("grai find", () => {
	it("prints a key's line in each catalog, each call site, and each other place that names it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/Header.tsx": headerTsx,
			"src/lib/i18n.ts": i18nTs,
			"src/labels.ts": 'export const labels = { cart_title: "Cart" };\n',
		});

		const found = await find(config, "cart_title");

		expect(found.errors).toEqual([]);
		expect(foundLines("cart_title", found).toSorted()).toEqual([
			'grai: "cart_title" is in 2 catalogs and 4 call sites, and named in 1 other place',
			'messages/de.json:2:2: "cart_title": "Ihr Warenkorb",',
			'messages/en.json:2:2: "cart_title": "Your cart",',
			"src/Cart.svelte:7:8: <h1>{m.cart_title()}</h1>",
			'src/Cart.svelte:8:14: <p title={m["cart_title"]()}>{cart_total({ count })}</p>',
			"src/Header.tsx:4:27: return <h1 aria-label={m.cart_title()}>{m?.cart_title()}</h1>;",
			"src/Header.tsx:4:45: return <h1 aria-label={m.cart_title()}>{m?.cart_title()}</h1>;",
			'src/labels.ts:1:25: export const labels = { cart_title: "Cart" }; (not a call site)',
		]);
	});

	it("finds a per-key import and the uses of the name it binds", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, { "src/Cart.svelte": cartSvelte });

		const found = await find(config, "cart_total");

		expect(
			found.callSites.map(({ line, column }) => `${line}:${column}`),
		).toEqual(["3:11", "3:45", "8:31", "9:15"]);
		expect(found.mentions).toEqual([]);
	});

	it("reports a key no catalog has, with the places that name it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/a.ts": 'import { m } from "./m.js";\nm.cart_gone();\n',
		});

		const found = await find(config, "cart_gone");

		expect(found.callSites).toHaveLength(1);
		expect(found.errors.map((error) => error.message)).toEqual([
			'messages/en.json: "cart_gone": no catalog has the key.',
		]);
	});
});
