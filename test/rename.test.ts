import {
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
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
	it("renames a key a file writes with an escape, writing it plainly", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/app.js": `import { m } from "../out/messages.js";\nm.cart_t\\u0069tle();\nm["cart_t\\x69tle"]();\n`,
		});

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/app.js")).toBe(
			'import { m } from "../out/messages.js";\nm.basket_title();\nm["basket_title"]();\n',
		);
	});

	it("renames reads of the key in code, never a string or a comment that mentions it", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/app.js": `import { m } from "../out/messages.js";\n// m.cart_title() is the cart's heading\nexport const label = "m.cart_title";\nexport const heading = m.cart_title();\n`,
		});

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.errors).toEqual([]);
		expect(readText(dir, "src/app.js")).toBe(
			`import { m } from "../out/messages.js";\n// m.cart_title() is the cart's heading\nexport const label = "m.cart_title";\nexport const heading = m.basket_title();\n`,
		);
	});

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

	it("names each file it changed as the project does when the project is reached through a symlink", async () => {
		const { dir } = app();
		const link = join(
			realpathSync(mkdtempSync(join(tmpdir(), "grai-link-"))),
			"app",
		);
		onTestFinished(() =>
			rmSync(dirname(link), { recursive: true, force: true }),
		);
		symlinkSync(dir, link);

		const result = await rename(
			join(link, "grai.config.json"),
			"cart_title",
			"basket_title",
		);

		expect(result.errors).toEqual([]);
		expect(result.changed.toSorted()).toEqual([
			"messages/de.json",
			"messages/en.json",
			"src/Cart.svelte",
			"src/Header.tsx",
		]);
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

	it("renames a per-key module a test loads late, its path and the name it destructures", async () => {
		const { dir, config } = app();
		const late = `const { cart_title } = await import("#i18n/messages/cart_title.js");\nexpect(cart_title()).toBe("Your cart");\n`;
		writeSources(dir, { "src/title.test.ts": late });

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/title.test.ts")).toBe(
			late.replaceAll("cart_title", "basket_title"),
		);
	});

	it("leaves a name that reads no key alone, such as a property named like it", async () => {
		const { dir, config } = app();
		const labels = 'export const labels = { cart_title: "Cart" };\n';
		writeSources(dir, { "src/labels.ts": labels });

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/labels.ts")).toBe(labels);
		expect(readText(dir, "src/Header.tsx")).toBe(
			headerTsx.replaceAll("cart_title", "basket_title"),
		);
	});

	it("refuses while a read by a computed name may reach the key, and names the read", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/render.ts":
				'import { m } from "$lib/i18n";\nexport const render = (name: string) => m[name]();\n',
		});

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.errors.map(({ message }) => message)).toEqual([
			'src/render.ts:2:41: m[name] may read "cart_title", so the rename cannot tell whether to change it. Read the key by its name there, or rename it by hand.',
		]);
		expect(result.changed).toEqual([]);
	});

	it("refuses while a per-key module is loaded by a built path, and names the load", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/load.ts": `export const load = (name: string) => import(\`#i18n/messages/\${name}.js\`);\n`,
		});

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.errors.map(({ message }) => message)).toEqual([
			`src/load.ts:1:39: import(\`#i18n/messages/\${name}.js\`) may read "cart_title", so the rename cannot tell whether to change it. Read the key by its name there, or rename it by hand.`,
		]);
		expect(result.changed).toEqual([]);
	});

	it("renames the namespace's reads by scope, and none of a parameter of the same name", async () => {
		const { dir, config } = app();
		const render =
			'import { m } from "$lib/i18n";\nexport function render(m) {\n\treturn m.cart_title();\n}\nexport const heading = m.cart_title();\n';
		writeSources(dir, { "src/render.js": render });

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/render.js")).toBe(
			render.replace("= m.cart_title()", "= m.basket_title()"),
		);
	});

	it("leaves a string in an array alone, which reads no member", async () => {
		const { dir, config } = project(catalogs);
		const data = `import { m } from "../out/messages.js";\nexport const data = ["m.cart_title"];\nexport const heading = m.cart_title();\n`;
		writeSources(dir, { "src/data.js": data });

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/data.js")).toBe(
			data.replace("m.cart_title()", "m.basket_title()"),
		);
	});

	it("renames a read inside JSX text, and none in a regular expression after a /", async () => {
		const { dir, config } = project(catalogs);
		const view = `import { m } from "../out/messages.js";\nexport const View = () => <p>don't {m.cart_title()} don't</p>;\nif (true) /m.cart_title/.test("anything");\n`;
		writeSources(dir, { "src/View.jsx": view });

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/View.jsx")).toBe(
			view.replace("{m.cart_title()}", "{m.basket_title()}"),
		);
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

	it("refuses to rename a binding named after the key where the new name is taken, and names the place", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/Cart.svelte": cartSvelte.replace(
				"let { count } = $props();",
				"let { count } = $props();\n\tconst basket_total = 1;",
			),
			"src/total.ts": [
				'import { cart_total } from "#i18n/messages/cart_total.js";',
				"export const total = (count: number) => {",
				"\tconst basket_total = cart_total({ count });",
				"\treturn [basket_total, cart_total];",
				"};",
				"export const label = () => basket_label(cart_total);",
				"",
			].join("\n"),
		});

		const result = await rename(config, "cart_total", "basket_total");

		const taken =
			"Rename this basket_total first, or import the key under another name.";
		expect(result.errors.map(({ message }) => message)).toEqual([
			`src/Cart.svelte:5:8: basket_total is declared here, where cart_total, the key's binding, would take that name with the key. ${taken}`,
			`src/total.ts:3:8: basket_total is declared here, where cart_total, the key's binding, would take that name with the key. ${taken}`,
		]);
		expect(result.changed).toEqual([]);
	});

	it("refuses where the new name is declared with an escape, as a name the file never writes plainly", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/total.ts": [
				'import { cart_total } from "#i18n/messages/cart_total.js";',
				"export const total = (count: number) => {",
				"\tconst basket_\\u0074otal = cart_total({ count });",
				"\treturn cart_total;",
				"};",
				"",
			].join("\n"),
		});

		const result = await rename(config, "cart_total", "basket_total");

		expect(result.errors.map(({ file }) => file)).toEqual(["src/total.ts:3:8"]);
		expect(result.changed).toEqual([]);
	});

	it("renames a binding named after the key where a longer name holds the new one, as that is another name", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/total.ts": [
				'import { cart_total } from "#i18n/messages/cart_total.js";',
				"export const total = (count: number) => {",
				"\tconst basket_total_count = count;",
				"\treturn cart_total({ count: basket_total_count });",
				"};",
				"",
			].join("\n"),
		});

		const result = await rename(config, "cart_total", "basket_total");

		expect(result.errors).toEqual([]);
		expect(readText(dir, "src/total.ts")).toContain(
			"return basket_total({ count: basket_total_count });",
		);
	});

	it("refuses where the new name would read the key's binding, or a nearer one would take its reference", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/total.ts": [
				'import { cart_total } from "#i18n/messages/cart_total.js";',
				"export const sum = () => basket_total + cart_total.length;",
				"export function format(basket_total: number) {",
				"\treturn cart_total({ count: basket_total });",
				"}",
				"",
			].join("\n"),
		});

		const result = await rename(config, "cart_total", "basket_total");

		expect(result.errors.map(({ file }) => file)).toEqual([
			"src/total.ts:2:26",
			"src/total.ts:3:24",
		]);
		expect(result.errors[0]?.message).toBe(
			"src/total.ts:2:26: basket_total here would read the key's binding once it takes that name with the key. Rename this basket_total first, or import the key under another name.",
		);
	});

	it("writes a shorthand out in full where the key's binding takes the new name", async () => {
		const { dir, config } = app();
		const imported =
			'import { cart_total } from "#i18n/messages/cart_total.js";';
		writeSources(dir, {
			"src/Total.svelte": `<script>\n\t${imported}\n</script>\n<Price {cart_total} />\n`,
			"src/Total.vue": `<script setup>\n${imported}\n</script>\n<template><Price :cart_total /></template>\n`,
			"src/total.ts": `${imported}\nexport const labels = { cart_total };\n`,
		});

		expect((await rename(config, "cart_total", "basket_total")).errors).toEqual(
			[],
		);
		const renamed = imported.replaceAll("cart_total", "basket_total");
		expect(readText(dir, "src/Total.svelte")).toBe(
			`<script>\n\t${renamed}\n</script>\n<Price cart_total={basket_total} />\n`,
		);
		expect(readText(dir, "src/Total.vue")).toBe(
			`<script setup>\n${renamed}\n</script>\n<template><Price :cart_total="basket_total" /></template>\n`,
		);
		expect(readText(dir, "src/total.ts")).toBe(
			`${renamed}\nexport const labels = { cart_total: basket_total };\n`,
		);
	});

	it("renames a key through each module that passes it on by its own name, and no name a module gives it", async () => {
		const { dir, config } = app();
		writeSources(dir, {
			"src/lib/keys.ts":
				'export { cart_title } from "../../out/keys.js";\nexport { cart_title as heading } from "../../out/keys.js";\n',
			"src/lib/index.ts": 'export * from "./keys.ts";\n',
			"src/page.ts":
				'import { cart_title, heading } from "./lib/index.ts";\nimport * as lib from "./lib/keys.ts";\nexport const page = [cart_title(), heading(), lib.cart_title(), lib.heading()];\n',
		});

		expect((await rename(config, "cart_title", "basket_title")).errors).toEqual(
			[],
		);
		expect(readText(dir, "src/lib/keys.ts")).toBe(
			'export { basket_title } from "../../out/keys.js";\nexport { basket_title as heading } from "../../out/keys.js";\n',
		);
		expect(readText(dir, "src/page.ts")).toBe(
			'import { basket_title, heading } from "./lib/index.ts";\nimport * as lib from "./lib/keys.ts";\nexport const page = [basket_title(), heading(), lib.basket_title(), lib.heading()];\n',
		);
	});

	it("renames the key in the config's identicalToBase too, listing it once, and leaves the rest of the config as written", async () => {
		const { dir, config } = app();
		writeFileSync(
			config,
			`{
	"locales": ["en", "de"],
	"baseLocale": "en",
	"catalogs": "messages/{locale}.json",
	"outdir": "out",
	"identicalToBase": {
		"de": ["cart_title", "basket_title"]
	}
}
`,
		);

		const result = await rename(config, "cart_title", "basket_title");

		expect(result.changed).toContain("grai.config.json");
		expect(readText(dir, "grai.config.json")).toBe(`{
	"locales": ["en", "de"],
	"baseLocale": "en",
	"catalogs": "messages/{locale}.json",
	"outdir": "out",
	"identicalToBase": {
		"de": [
			"basket_title"
		]
	}
}
`);
	});
});
