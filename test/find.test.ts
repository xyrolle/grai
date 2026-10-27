import { describe, expect, it } from "vitest";
import { find, foundLines } from "../src/find.ts";
import { project } from "./project.ts";
import {
	cartSvelte,
	cartTest,
	headerTsx,
	i18nTs,
	installPackage,
	packageApp,
	writeSources,
} from "./sources.ts";

const catalogs = {
	en: { cart_title: "Your cart", cart_total: "{count} items" },
	de: { cart_title: "Ihr Warenkorb", cart_total: "{count} Artikel" },
};

describe("grai find", () => {
	it("prints a key's line in each catalog and each call site, and no other text that spells it", async () => {
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
			'grai: "cart_title" is in 2 catalogs and 4 call sites',
			'messages/de.json:2:2: "cart_title": "Ihr Warenkorb",',
			'messages/en.json:2:2: "cart_title": "Your cart",',
			"src/Cart.svelte:7:8: <h1>{m.cart_title()}</h1>",
			'src/Cart.svelte:8:14: <p title={m["cart_title"]()}>{cart_total({ count })}</p>',
			"src/Header.tsx:4:27: return <h1 aria-label={m.cart_title()}>{m?.cart_title()}</h1>;",
			"src/Header.tsx:4:45: return <h1 aria-label={m.cart_title()}>{m?.cart_title()}</h1>;",
		]);
	});

	it("finds a key's call sites in tests too, which check does not count", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/lib/i18n.ts": i18nTs,
			"src/cart.test.ts": `import { m } from "$lib/i18n";\n${cartTest}`,
		});

		const found = await find(config, "cart_title");

		expect(found.callSites.map(({ file, line }) => `${file}:${line}`)).toEqual([
			"src/cart.test.ts:2",
		]);
	});

	it("finds a per-key import and the uses of the name it binds", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, { "src/Cart.svelte": cartSvelte });

		const found = await find(config, "cart_total");

		expect(
			found.callSites.map(({ line, column }) => `${line}:${column}`),
		).toEqual(["3:11", "3:45", "8:31", "9:15"]);
		expect(found.reaches).toEqual([]);
	});

	it("reports a key no catalog has, with the places that name it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.cart_gone();\n',
		});

		const found = await find(config, "cart_gone");

		expect(found.callSites).toHaveLength(1);
		expect(found.errors.map((error) => error.message)).toEqual([
			'messages/en.json: "cart_gone": no catalog has the key.',
		]);
	});

	it("lists the reads that may reach a key without naming it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/lib/i18n.ts": i18nTs,
			"src/pick.ts": [
				'import { m } from "$lib/i18n";',
				`export const pick = (name: string) => m[\`cart_\${name}\`]();`,
				"export const all = () => Object.keys(m);",
				`export const promo = (name: string) => m[\`promo_\${name}\`]();`,
				"",
			].join("\n"),
		});

		const found = await find(config, "cart_title");

		expect(foundLines("cart_title", found).slice(2)).toEqual([
			`src/pick.ts:2:39: export const pick = (name: string) => m[\`cart_\${name}\`](); (may read it)`,
			"src/pick.ts:3:38: export const all = () => Object.keys(m); (may read it)",
			'grai: "cart_title" is in 2 catalogs and 0 call sites, and may be read at 2 other places',
		]);
	});

	it("finds a key's call sites in a project that imports the package's entries by its name", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart", cart_terms: "Read the {#b}terms{/b}" },
		});
		writeSources(dir, packageApp);
		installPackage(dir);

		const found = await find(config, "cart_terms");

		expect(found.errors).toEqual([]);
		expect(foundLines("cart_terms", found).toSorted()).toEqual([
			'grai: "cart_terms" is in 1 catalog and 1 call site',
			'messages/en.json:3:2: "cart_terms": "Read the {#b}terms{/b}"',
			"src/Cart.tsx:7:20: <Markup parts={m.cart_terms.parts()} markup={{ b: (children) => <b>{children}</b> }} />",
		]);
	});
});
