import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { fixLines, removeUnusedKeys } from "../src/fix.ts";
import { project } from "./project.ts";
import {
	cart,
	cartApp,
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
	it("keeps a key a file reads through an import with a comment in it, or by an escaped name", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/dynamic.js": `import /* the messages */ { m } from "../out/messages.js";\nexport const show = (key) => m[key]();\nm.cart_total({ count: 1 });\n`,
			"src/escaped.js": `import { m } from "../out/messages.js";\nm.cart_t\\u0069tle();\n`,
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
	});

	it("removes the keys no source names from every catalog, keeping each catalog's layout", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
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

	it("hands the check after it the sources it read, beside the catalogs as it wrote them", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
		});

		const fixed = await removeUnusedKeys(config);
		// Written after the fix read the sources, so in none it hands on.
		writeSources(dir, {
			"src/late.js":
				'import { m } from "../out/messages.js";\nm.cart_titel();\n',
		});

		expect(fixed.removed).toEqual(["banner_old"]);
		expect((await check(config, undefined, fixed.code)).problems).toEqual([]);
		expect((await check(config)).problems.map(({ code }) => code)).toEqual([
			"key-missing",
		]);
	});

	it("removes nothing while a source that may read the messages does not parse, and says where", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
			"src/total.ts":
				'import { m } from "../out/messages.js";\nexport const total = ;\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixed.changed).toEqual([]);
		expect(fixed.errors.map(({ code, file }) => `${code}: ${file}`)).toEqual([
			"source-invalid: src/total.ts:2:22",
		]);
	});

	it("removes the unused keys while a source that names nothing of grai's does not parse, as it reads none", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
			"src/total.ts": "export const total = ;\n",
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.errors).toEqual([]);
		expect(fixed.removed).not.toEqual([]);
	});

	it("keeps the keys a dynamic import may load by a built path, with a comment inside its call", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
			"src/load.js": `export const load = async (name) =>\n\t(await import(/* split */ \`#i18n/messages/\${name}.js\`))[name]();\n`,
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixLines(fixed)).toEqual([
			`kept: src/load.js:2:9: import(/* split */ \`#i18n/messages/\${name}.js\`) may name 2 unused keys, so they stay`,
		]);
	});

	it("removes a key only a load by a path the code computes could load, as a bundler bundles nothing for it, and lists it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
			"src/load.js":
				"export const load = async (path) => (await import(path)).default;\n",
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixLines(fixed)).toEqual([
			'removed: "banner_old" from every catalog',
		]);
	});

	it("keeps the keys a module object used whole holds, and only those", async () => {
		const register = (name: string, path: string) =>
			`import * as ${name} from "${path}";\nexport const helpers = [${name}];\n`;
		const holding = project(catalogs);
		const holdingNone = project(catalogs);
		writeSources(holding.dir, {
			...cart,
			"src/register.ts": register("i18n", "./lib/i18n.ts"),
		});
		writeSources(holdingNone.dir, {
			...cart,
			"src/lib/format.ts": "export const money = (n: number) => String(n);\n",
			"src/register.ts": register("format", "./lib/format.ts"),
		});

		const kept = await removeUnusedKeys(holding.config);
		const removed = await removeUnusedKeys(holdingNone.config);

		expect(fixLines(kept)).toEqual([
			"kept: src/register.ts:2:25: i18n may name 2 unused keys, so they stay",
		]);
		expect(removed.removed).toEqual(["banner_old", "promo_spring"]);
	});

	it("takes each unused entry out with the separator before it, leaving every other byte as it is written", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
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
			...cart,
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
			...cart,
			"src/promo.test.ts":
				'import { m } from "$lib/i18n";\n\nexpect(m.promo_spring()).toBe("Spring sale");\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixLines(fixed)).toEqual([
			'removed: "banner_old" from every catalog',
			'removed: "promo_spring" from every catalog; tests still name it: src/promo.test.ts',
		]);
	});

	it("keeps a key that is no key name, which a source reads by a string", async () => {
		const { dir, config, compile } = project(catalogs);
		await compile();
		// Added once the output is built, which the fix reads the code against.
		writeSources(dir, {
			...cartApp,
			"messages/en.json": JSON.stringify({
				...catalogs.en,
				"sign-in": "Sign in",
			}),
			"messages/de.json": JSON.stringify({
				...catalogs.de,
				"sign-in": "Anmelden",
			}),
			"src/SignIn.svelte":
				'<script>\n\timport { m } from "$lib/i18n";\n</script>\n<button>{m["sign-in"]()}</button>\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual(["banner_old"]);
		expect(readText(dir, "messages/de.json")).toContain('"sign-in":"Anmelden"');
		const { problems } = await check(config);
		expect(problems.map(({ code, key }) => `${code}: ${key}`)).toEqual([
			"key-invalid: sign-in",
		]);
	});

	it("removes nothing while an import of the output resolves nowhere, and says what to declare", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cartApp,
			"src/banner.ts":
				'import { m } from "$i18n/out/messages.js";\nimport { promo_spring } from "#keys/messages/promo_spring.js";\nexport const banner = () => [m.banner_old(), promo_spring()];\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixed.errors.map(({ message }) => message)).toEqual([
			'src/banner.ts:1:19: $i18n/out/messages.js is a path to grai\'s output, but nothing the project declares resolves it, so grai cannot tell what it reads. Declare it as the bundler resolves it: a Vite alias, a tsconfig path or a package.json "imports" entry.',
			'src/banner.ts:2:30: #keys/messages/promo_spring.js is a path to grai\'s output, but nothing the project declares resolves it, so grai cannot tell what it reads. Declare it as the bundler resolves it: a Vite alias, a tsconfig path or a package.json "imports" entry.',
		]);
	});

	it("removes nothing while the output it reads code against is missing and does not compile", async () => {
		const { dir, config } = project({
			en: { ...catalogs.en, "sign-in": "Sign in" },
			de: { ...catalogs.de, "sign-in": "Anmelden" },
		});
		writeSources(dir, { ...cartApp });

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
		expect(fixed.errors.map(({ code, key }) => `${code}: ${key}`)).toEqual([
			"key-invalid: sign-in",
		]);
	});

	it("removes the keys only a test may reach, which ships nothing", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
			"src/messages.test.ts":
				'import { m } from "$lib/i18n";\n\nfor (const key of Object.keys(m)) expect(m[key]).toBeTypeOf("function");\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual(["banner_old", "promo_spring"]);
	});

	it("keeps the unused keys a read by a computed name may reach, and says which read", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
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
			...cart,
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

	it("keeps every key a computed read through a namespace import of the messages module may reach", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
			"src/promo.ts":
				'import * as messages from "../out/messages.js";\nexport const promo = (season: string) => messages.m[season + "_spring"]();\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
	});

	it("keeps a key a Vue template names with an HTML entity, as Vue decodes it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/Cart.vue": [
				"<script setup>",
				'import { m } from "../out/messages.js";',
				"</script>",
				`<template><p :title="m['cart_tit&#108;e']()">{{ m.cart_total({ count: 1 }) }}</p></template>`,
				"",
			].join("\n"),
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed.toSorted()).toEqual(["banner_old", "promo_spring"]);
	});

	it("keeps a key that only an Astro page or an MDX document names", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
			"src/pages/promo.astro":
				'---\nimport { m } from "../../out/messages.js";\n---\n<p>{m.promo_spring()}</p>\n',
			"src/content/sale.mdx":
				'import { m } from "../../out/messages.js";\n\n# {m.banner_old()}\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
	});

	it("takes a computed name's literal start as its reach only when a name alone follows it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
			"src/pick.ts":
				'import { m } from "$lib/i18n";\nexport const pick = (name: string) => m["cart" + name ? "promo" + "_spring" : "banner" + "_old"]();\n',
		});

		const fixed = await removeUnusedKeys(config);

		expect(fixed.removed).toEqual([]);
	});

	it("keeps every unused key while a source reads the namespace whole", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			...cart,
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
			...cart,
			"src/promo.tsx": `import { promo_spring } from "#i18n/messages/promo_spring.js";
import { unit_km } from "#i18n/messages/unit_km.js";
export const Promo = () => <p>{promo_spring()} {unit_km()}</p>;
`,
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
