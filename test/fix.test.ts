import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { fixLines, removeUnusedKeys } from "../src/fix.ts";
import { project } from "./project.ts";
import { cartSvelte, readText, writeSources } from "./sources.ts";

const catalogs = {
	en: {
		cart_title: "Your cart",
		cart_total: "{count} items",
		banner_old: "Sale!",
		promo_spring: "Spring sale",
	},
	de: {
		cart_title: "Ihr Warenkorb",
		cart_total: "{count} Artikel",
		banner_old: "Ausverkauf!",
		promo_spring: "Frühlingsangebot",
	},
};

describe("grai check --fix", () => {
	it("removes the keys no source names from every catalog, keeping each catalog's layout", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.tsx": "export const Promo = () => <p>{promo_spring()}</p>;\n",
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixLines(fixed)).toEqual([
			'removed: "banner_old" from every catalog',
		]);
		expect(fixed.changed.toSorted()).toEqual([
			"messages/de.json",
			"messages/en.json",
		]);
		const { banner_old, ...kept } = catalogs.de;
		expect(readText(dir, "messages/de.json")).toBe(
			JSON.stringify(kept, null, "\t"),
		);
		expect((await check(config)).problems).toEqual([]);
	});

	it("keeps the unused keys a read by a computed name may reach, and says which read", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.ts": `import { m } from "$lib/i18n";
export const promo = (season: string) => m[\`promo_\${season}\`]();
`,
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixLines(fixed)).toEqual([
			'removed: "banner_old" from every catalog',
			`kept: src/promo.ts:2:42: m[\`promo_\${season}\`] may name "promo_spring", so it stays`,
		]);
	});

	it("follows the namespace under a name a module exports it as", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/lib/t.ts":
				'import { m } from "../../out/messages.js";\nexport { m as t };\n',
			"src/promo.ts":
				'import { t } from "./lib/t.ts";\nexport const promo = (name: string) => t[name]();\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixLines(fixed)).toEqual([
			"kept: src/promo.ts:2:40: t[name] may name 2 unused keys, so they stay",
		]);
	});

	it("keeps every unused key while a source reads the namespace whole", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/all.ts":
				'import { m } from "$lib/i18n";\nexport const keys = Object.keys(m);\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixLines(fixed)).toEqual([
			"kept: src/all.ts:2:33: m may name 2 unused keys, so they stay",
		]);
		expect(fixed.changed).toEqual([]);
	});
});
