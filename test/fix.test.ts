import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { fixLines, removeUnusedKeys } from "../src/fix.ts";
import { project } from "./project.ts";
import {
	cartSvelte,
	handLaid,
	readText,
	schemaEntry,
	writeSources,
} from "./sources.ts";

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

	it("takes each unused entry out with the separator before it, leaving every other byte as it is written", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.tsx": "export const Promo = () => <p>{promo_spring()}</p>;\n",
		});
		const entries = [
			schemaEntry,
			'"cart_title":"Ihr Warenkorb"',
			'"banner_old": "Ausverkauf!"',
			'"cart_total" :  "{count} Artikel \\u00e9"',
			'"promo_spring": "Frühlingsangebot"',
		];
		writeSources(dir, { "messages/de.json": handLaid(...entries) });

		await removeUnusedKeys(config);

		const kept = entries.filter((entry) => !entry.startsWith('"banner_old"'));
		expect(readText(dir, "messages/de.json")).toBe(handLaid(...kept));
	});

	it("keeps a key that a shipped route in a folder named tests names", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/routes/tests/+page.svelte":
				'<script>\n\timport { m } from "$lib/i18n";\n</script>\n<p>{m.promo_spring()}</p>\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual(["banner_old"]);
		expect((await check(config)).problems).toEqual([]);
	});

	it("removes a key that only a test names, and says the test names it still", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.test.ts": 'expect(m.promo_spring()).toBe("Spring sale");\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixLines(fixed)).toEqual([
			'removed: "banner_old" from every catalog',
			'removed: "promo_spring" from every catalog; tests still name it: src/promo.test.ts',
		]);
	});

	it("keeps a key that is no key name, which a source may write where the scan sees no name", async () => {
		const { dir, config } = project({
			en: { ...catalogs.en, "sign-in": "Sign in" },
			de: { ...catalogs.de, "sign-in": "Anmelden" },
		});
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.tsx": "export const Promo = () => <p>{promo_spring()}</p>;\n",
			"src/SignIn.svelte": '<button>{m["sign-in"]()}</button>\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual(["banner_old"]);
		expect(readText(dir, "messages/de.json")).toContain(
			'"sign-in": "Anmelden"',
		);
		const { problems } = await check(config);
		expect(problems.map(({ code, key }) => `${code}: ${key}`)).toEqual([
			"key-invalid: sign-in",
		]);
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

	it("keeps a key that only an Astro page or an MDX document names", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/pages/promo.astro":
				'---\nimport { m } from "../../out/messages.js";\n---\n<p>{m.promo_spring()}</p>\n',
			"src/content/sale.mdx":
				'import { m } from "../../out/messages.js";\n\n# {m.banner_old()}\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
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

	it("removes a key it removes from the config's identicalToBase too", async () => {
		const { dir, config } = project({
			en: { ...catalogs.en, unit_km: "km" },
			de: { ...catalogs.de, banner_old: "Sale!", unit_km: "km" },
		});
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte,
			"src/promo.tsx":
				"export const Promo = () => <p>{promo_spring()} {unit_km()}</p>;\n",
		});
		writeFileSync(
			config,
			`{
	"locales": ["en", "de"],
	"baseLocale": "en",
	"catalogs": "messages/{locale}.json",
	"outdir": "out",
	"identicalToBase": {
		"de": ["banner_old", "unit_km"]
	}
}
`,
		);

		const fixed = await removeUnusedKeys(config);

		expect(fixed.changed).toContain("grai.config.json");
		expect(readText(dir, "grai.config.json")).toContain(
			'\t"identicalToBase": {\n\t\t"de": [\n\t\t\t"unit_km"\n\t\t]\n\t}\n}\n',
		);
		expect((await check(config)).problems).toEqual([]);
	});
});
