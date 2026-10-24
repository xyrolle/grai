import { describe, expect, it } from "vitest";
import { rename } from "../src/rename.ts";
import { project } from "./project.ts";
import {
	cartSvelte,
	cartTest,
	handLaid,
	headerTsx,
	i18nTs,
	readText,
	schemaEntry,
	writeSources,
} from "./sources.ts";

const catalogs = {
	en: { cart_title: "Your cart", cart_total: "{count} items" },
	de: { cart_title: "Ihr Warenkorb", cart_total: "{count} Artikel" },
};

/** A project with the fixtures' Svelte, TSX and TypeScript sources. */
function app() {
	const shop = project(catalogs);
	writeSources(shop.dir, {
		"src/Cart.svelte": cartSvelte,
		"src/Header.tsx": headerTsx,
		"src/lib/i18n.ts": i18nTs,
	});
	return shop;
}

describe("grai rename", () => {
	it("renames a key in every catalog and where the namespace reads it, then compiles", async () => {
		const shop = app();
		const { dir, config } = shop;

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.errors).toEqual([]);
		expect(result.changed.toSorted()).toEqual([
			"messages/de.json",
			"messages/en.json",
			"src/Cart.svelte",
			"src/Header.tsx",
		]);
		expect(readText(dir, "messages/de.json")).toBe(
			JSON.stringify(
				{ basket_title: "Ihr Warenkorb", cart_total: "{count} Artikel" },
				null,
				"\t",
			),
		);
		expect(readText(dir, "src/Cart.svelte")).toContain(
			'<h1>{m.basket_title()}</h1>\n<p title={m["basket_title"]()}>',
		);
		expect(readText(dir, "src/Header.tsx")).toContain(
			"<h1 aria-label={m.basket_title()}>{m?.basket_title()}</h1>",
		);
		expect((await shop.load()).m.basket_title?.()).toBe("Your cart");
	});

	it("changes only the key's string in a catalog, leaving every other byte as it is written", async () => {
		const { dir, config } = app();
		const total = '"cart_total" :  "{count} Artikel \\u00e9"';
		const catalog = (key: string) =>
			handLaid(schemaEntry, `"${key}":"Ihr Warenkorb"`, total);
		writeSources(dir, { "messages/de.json": catalog("cart_title") });

		await rename(config, "cart_title", "basket_title");

		expect(readText(dir, "messages/de.json")).toBe(catalog("basket_title"));
	});

	it("renames the key in tests too, which check does not count", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/cart.test.ts": `import { m } from "$lib/i18n";\n${cartTest}`,
		});

		await rename(config, "cart_title", "basket_title");

		expect(readText(dir, "src/cart.test.ts")).toBe(
			`import { m } from "$lib/i18n";\n${cartTest.replace("cart_title", "basket_title")}`,
		);
	});

	it("renames a per-key import's path and name, and every use of the name it binds", async () => {
		const { dir, config } = app();
		// Without semicolons, and with Windows line breaks.
		const total = [
			'import { cart_total } from "#i18n/messages/cart_total.js"',
			"const label = cart_total({ count: 1 })",
			"cart_total({ count: 2 })",
			"",
		].join("\r\n");
		writeSources(dir, { "src/total.ts": total });

		expect((await rename(config, "cart_total", "basket_total")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/Cart.svelte")).toBe(
			cartSvelte.replaceAll("cart_total", "basket_total"),
		);
		expect(readText(dir, "src/total.ts")).toBe(
			total.replaceAll("cart_total", "basket_total"),
		);
	});

	it("changes nothing when a source names the key where it may mean something else", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/labels.ts": 'export const labels = { cart_title: "Cart" };\n',
		});

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.errors.map((error) => error.message)).toEqual([
			'src/labels.ts:1:25: it names cart_title, but not as m.cart_title, m["cart_title"] or a per-key import, so the rename cannot tell that it means the key. Write it as one of those, or rename it by hand.',
		]);
		expect(result.changed).toEqual([]);
		expect(readText(dir, "src/Header.tsx")).toBe(headerTsx);
		expect(readText(dir, "messages/en.json")).toContain('"cart_title"');
	});

	it("refuses a name another key has, in any case, and a name that is no key name", async () => {
		const { config } = app();

		expect(
			(await rename(config, "cart_title", "cart_total")).errors.map(
				(error) => error.message,
			),
		).toEqual([
			'messages/en.json: "cart_title": the catalogs have "cart_total" already. Choose another name.',
		]);
		expect(
			(await rename(config, "cart_title", "Cart_Total")).errors.map(
				(error) => error.message,
			),
		).toEqual([
			'messages/en.json: "cart_title": the catalogs have "cart_total" already, which "Cart_Total" would collide with, ignoring case. Choose another name.',
		]);
		expect(
			(await rename(config, "cart_title", "new")).errors.map(
				(error) => error.code,
			),
		).toEqual(["key-invalid"]);
	});

	it("refuses to bind the new name in a file that already names it", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/Cart.svelte": `${cartSvelte}<script>const basket_total = 1;</script>\n`,
		});

		expect(
			(await rename(config, "cart_total", "basket_total")).errors.map(
				(error) => error.message,
			),
		).toEqual([
			'src/Cart.svelte: "cart_total": the file imports cart_total by its own name, and already names basket_total, which the renamed import would clash with. Rename that first.',
		]);
	});
});
