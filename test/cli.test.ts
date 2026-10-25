import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { project } from "./project.ts";
import { handLaid, readText, schemaEntry, writeSources } from "./sources.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/** Runs the CLI in a directory, returning its exit code and what it printed. */
function grai(
	dir: string,
	...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((done) => {
		execFile(
			process.execPath,
			[cli, ...args],
			{ cwd: dir },
			(error, stdout, stderr) => {
				done({ code: error === null ? 0 : Number(error.code), stdout, stderr });
			},
		);
	});
}

const catalogs = {
	en: { cart_title: "Your cart", cart_greeting: "Hello {name}" },
	de: { cart_title: "Ihr Warenkorb", cart_greeting: "Hallo {name}" },
};

describe("grai compile", () => {
	it("writes the output and says so, and next time says it is up to date", async () => {
		const { dir } = project(catalogs);

		expect((await grai(dir, "compile")).stdout).toMatch(
			/^grai: wrote 13 files in out \(.+ ms\)\n$/,
		);
		expect((await grai(dir, "compile")).stdout).toMatch(
			/^grai: out is up to date \(.+ ms\)\n$/,
		);
	});

	it("prints every error, sorted, and exits with 1", async () => {
		const { dir } = project({
			en: { b: "{ x }", a: "{ y }" },
			de: { b: "B", a: "A" },
		});
		const { code, stderr } = await grai(dir, "compile");

		expect(code).toBe(1);
		expect(
			stderr.split("\n").map((line) => line.split(":").slice(0, 2).join(":")),
		).toEqual([
			'messages/en.json: "a" (en)',
			'messages/en.json: "b" (en)',
			"grai: 2 errors",
			"",
		]);
	});
});

describe("grai check", () => {
	it("reports keys no source names and inputs the locales disagree on, and writes nothing", async () => {
		const { dir } = project({
			en: { cart_title: "Your cart", cart_greeting: "Hello {name}" },
			de: { cart_title: "Ihr Warenkorb", cart_greeting: "Hallo" },
		});
		writeFileSync(
			join(dir, "app.ts"),
			'console.log(m.cart_greeting({ name: "Ana" }));',
		);
		const { code, stderr } = await grai(dir, "check");

		expect(code).toBe(1);
		expect(stderr).toBe(
			[
				'messages/de.json: "cart_greeting" (de): the message never shows {name}, which en shows. Show it here too, or drop it everywhere.',
				'messages/en.json: "cart_title": no source file under . names the key. Remove it from every catalog, or use it.',
				"grai: 2 errors",
				"",
			].join("\n"),
		);
		expect(existsSync(join(dir, "out"))).toBe(false);
	});

	it("counts a key that only tests name as unused, naming the tests, unless the config says no file is one", async () => {
		const sources = {
			"app.ts": "m.cart_title();",
			"src/greeting.spec.ts": "expect(m.cart_greeting({ name: 'Ana' }));",
			"tests/helpers.ts": "export const greet = () => m.cart_greeting;",
		};
		const shipping = project(catalogs);
		const counting = project(catalogs, { tests: [] });
		for (const { dir } of [shipping, counting]) {
			for (const [path, text] of Object.entries(sources)) {
				mkdirSync(join(dir, path, ".."), { recursive: true });
				writeFileSync(join(dir, path), text);
			}
		}

		expect((await grai(shipping.dir, "check")).stderr.split("\n")[0]).toBe(
			'messages/en.json: "cart_greeting": no source file under . names the key but tests, which ship nothing: src/greeting.spec.ts, tests/helpers.ts. Remove it from every catalog and from those tests, or use it.',
		);
		expect((await grai(counting.dir, "check")).code).toBe(0);
	});

	it("names each place a source names a key no catalog has, in Svelte, Vue and JavaScript, with the grai add that adds it", async () => {
		const { dir } = project(catalogs);
		const sources = {
			"src/Cart.svelte": `<script>\n\timport { m } from "$lib/i18n";\n</script>\n<h1>{m.cart_titel()}</h1>\n`,
			"src/Greeting.vue": `<script setup>\nimport { m } from "../out/messages.js";\n</script>\n<template><p>{{ m.cart_greeting({ name: "Ana" }) }} {{ m["cart_bye"]() }}</p></template>\n`,
			"src/app.js": `import { cart_title } from "#i18n/messages/cart_title.js";\nimport { cart_totl } from "#i18n/messages/cart_totl.js";\n`,
		};
		for (const [path, text] of Object.entries(sources)) {
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(join(dir, path), text);
		}

		const { code, stderr } = await grai(dir, "check");

		const fix = (key: string) =>
			`Add it with grai add ${key} --en "…" --de "…", or fix the name.`;
		expect(code).toBe(1);
		expect(stderr.split("\n")).toEqual([
			`src/Cart.svelte:4:8: "cart_titel": m.cart_titel names a key no catalog has. ${fix("cart_titel")}`,
			`src/Greeting.vue:4:59: "cart_bye": m["cart_bye"] names a key no catalog has. ${fix("cart_bye")}`,
			`src/app.js:2:43: "cart_totl": #i18n/messages/cart_totl.js names a key no catalog has. ${fix("cart_totl")}`,
			"grai: 3 errors",
			"",
		]);
	});

	it("counts no name that ends a longer word, such as 2xl's xl, as the key", async () => {
		const { dir } = project({
			en: { xl: "Extra large" },
			de: { xl: "Sehr groß" },
		});
		writeFileSync(join(dir, "app.ts"), 'export const size = "2xl";');

		expect((await grai(dir, "check")).stderr).toContain(
			'messages/en.json: "xl": no source file under . names the key.',
		);
	});

	it("says so when there is no problem", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "app.ts"), "m.cart_title(); m.cart_greeting;");

		expect(await grai(dir, "check")).toEqual({
			code: 0,
			stdout: "grai: no problems\n",
			stderr: "",
		});
	});

	it("lists each locale's untranslated keys before anything else, and they are no problem", async () => {
		const { dir } = project({
			en: { cart_title: "Your cart", cart_greeting: "Hello {name}" },
			de: { cart_title: "Your cart", cart_greeting: "Hallo {name}" },
		});
		writeFileSync(join(dir, "app.ts"), "m.cart_title(); m.cart_greeting;");

		expect(await grai(dir, "check")).toEqual({
			code: 0,
			stdout: "grai: 1 untranslated in de: cart_title\ngrai: no problems\n",
			stderr: "",
		});
		const json = await grai(dir, "check", "--json");
		expect([json.code, JSON.parse(json.stdout)]).toEqual([
			0,
			{ problems: [], untranslated: { de: ["cart_title"] } },
		]);
	});
});

describe("grai seed", () => {
	it("says how many keys it gave the base text, then compiles", async () => {
		const { dir } = project({
			en: { cart_title: "Your cart", cart_empty: "Empty" },
			de: { cart_title: "Ihr Warenkorb" },
		});

		const { code, stdout } = await grai(dir, "seed", "de");

		expect(code).toBe(0);
		expect(stdout).toMatch(
			/^grai: seeded 1 key into messages\/de\.json with the text of en\ngrai: wrote 13 files in out \(.+ ms\)\n$/,
		);
	});
});

describe("grai export and merge", () => {
	it("prints a locale's XLIFF, and merges it back, saying what it merged", async () => {
		const { dir } = project({
			en: { cart_title: "Your cart", cart_empty: "Empty" },
			de: { cart_title: "Your cart", cart_empty: "Leer" },
		});

		const exported = await grai(dir, "export", "de", "--untranslated");
		writeFileSync(
			join(dir, "de.xlf"),
			exported.stdout.replace(
				"<source>Your cart</source>",
				"<source>Your cart</source><target>Ihr Warenkorb</target>",
			),
		);
		const merged = await grai(dir, "merge", "de.xlf");

		expect(exported.code).toBe(0);
		expect(exported.stdout).toMatch(
			/^<\?xml version="1.0" encoding="UTF-8"\?>\n<xliff /,
		);
		expect(merged.code).toBe(0);
		expect(merged.stdout).toMatch(
			/^grai: merged 1 unit into 1 message of messages\/de\.json\ngrai: wrote 13 files in out/,
		);
		expect(
			JSON.parse(readFileSync(join(dir, "messages", "de.json"), "utf8")),
		).toEqual({
			cart_title: "Ihr Warenkorb",
			cart_empty: "Leer",
		});
	});
});

describe("grai find, rename and check --fix", () => {
	it("finds a key, renames it everywhere, then removes the key no source names", async () => {
		const { dir } = project({
			en: { cart_title: "Your cart", cart_old: "Old" },
			de: { cart_title: "Ihr Warenkorb", cart_old: "Alt" },
		});
		writeFileSync(
			join(dir, "app.ts"),
			'import { m } from "./out/messages.js";\nm.cart_title();\n',
		);

		expect((await grai(dir, "find", "cart_title")).stdout).toBe(
			[
				'messages/en.json:2:2: "cart_title": "Your cart",',
				'messages/de.json:2:2: "cart_title": "Ihr Warenkorb",',
				"app.ts:2:3: m.cart_title();",
				'grai: "cart_title" is in 2 catalogs and 1 call site',
				"",
			].join("\n"),
		);
		expect(
			(await grai(dir, "rename", "cart_title", "basket_title")).stdout,
		).toMatch(
			/^grai: renamed cart_title to basket_title in messages\/en\.json, messages\/de\.json, app\.ts\ngrai: wrote \d+ files in out/,
		);
		expect((await grai(dir, "check", "--fix", "--json")).code).toBe(2);
		expect(await grai(dir, "check", "--fix")).toEqual({
			code: 0,
			stdout: 'removed: "cart_old" from every catalog\ngrai: no problems\n',
			stderr: "",
		});
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toContain(
			"m.basket_title()",
		);
	});
});

describe("grai add", () => {
	it("adds a key with each locale's text to every catalog, in its layout, then compiles", async () => {
		const { dir } = project(catalogs);
		const { code, stdout } = await grai(
			dir,
			"add",
			"cart_empty",
			"--en",
			"Empty",
			"--de",
			"Leer",
		);

		expect(code).toBe(0);
		expect(stdout).toMatch(/^grai: wrote 13 files in out/);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(
			JSON.stringify({ ...catalogs.de, cart_empty: "Leer" }, null, "\t"),
		);
	});

	it("adds the key after the last entry, leaving every other byte of a catalog as it is written", async () => {
		const { dir } = project(catalogs);
		const own = [
			schemaEntry,
			'"cart_title":"Ihr Warenkorb \\u00e9"',
			'"cart_greeting" :  "Hallo {name}"',
		];
		writeFileSync(join(dir, "messages", "de.json"), handLaid(...own));

		const added = await grai(
			dir,
			"add",
			"cart_empty",
			"--en",
			"E",
			"--de",
			"L",
		);

		expect(added.code).toBe(0);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(
			handLaid(...own, '"cart_empty": "L"'),
		);
	});

	it("adds a key some catalogs have to the catalogs that lack it, with their texts", async () => {
		const { dir } = project({
			en: { ...catalogs.en, cart_empty: "Empty" },
			de: catalogs.de,
		});
		const en = readFileSync(join(dir, "messages", "en.json"), "utf8");
		const { code } = await grai(dir, "add", "cart_empty", "--de", "Leer");

		expect(code).toBe(0);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(
			JSON.stringify({ ...catalogs.de, cart_empty: "Leer" }, null, "\t"),
		);
		expect(readFileSync(join(dir, "messages", "en.json"), "utf8")).toBe(en);
	});

	it("writes nothing without every locale's text, for a key that exists, or for an invalid text", async () => {
		const { dir } = project({
			en: catalogs.en,
			de: { ...catalogs.de, cart_note: "Notiz" },
		});
		const before = readFileSync(join(dir, "messages", "de.json"), "utf8");
		const attempts = [
			await grai(dir, "add", "cart_empty", "--en", "Empty"),
			await grai(dir, "add", "cart_title", "--en", "Title", "--de", "Titel"),
			await grai(dir, "add", "cart_note", "--en", "Note", "--de", "Notiz"),
			await grai(
				dir,
				"add",
				"cart_total",
				"--en",
				"Total {sum :uppercase}",
				"--de",
				"Summe",
			),
		];

		expect(
			attempts.map(({ code, stderr }) => [code, stderr.split("\n")[0]]),
		).toEqual([
			[
				1,
				'messages/de.json: "cart_empty" (de): give the key\'s text in de too, with --de.',
			],
			[
				1,
				'messages/en.json: "cart_title": the key is already in the catalogs. Edit its messages there.',
			],
			[
				1,
				'messages/de.json: "cart_note" (de): the key is already in de. Edit its message there, and give a text only for the locales that lack the key.',
			],
			[
				1,
				'messages/en.json: "cart_total" (en): {sum :uppercase} calls :uppercase, which grai does not support; the formatting functions are :string, :number, :integer, :percent, :currency, :unit, :relativetime, :list, :datetime, :date, :time.',
			],
		]);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(before);
		expect(existsSync(join(dir, "out"))).toBe(false);
	});
});

describe("grai import", () => {
	it("prints what it left out, then what it wrote with the mapping, and needs --from", async () => {
		const { dir } = project({ en: {}, de: {} });
		rmSync(join(dir, "messages"), { recursive: true });
		mkdirSync(join(dir, "i18n"));
		writeFileSync(
			join(dir, "i18n", "en.json"),
			JSON.stringify({ cart: { title: "Cart" }, ago: "{{p, uppercase}}" }),
		);
		writeFileSync(
			join(dir, "i18n", "de.json"),
			JSON.stringify({
				cart: { title: "Warenkorb" },
				ago: "{{p, uppercase}}",
			}),
		);

		expect((await grai(dir, "import", "i18n")).code).toBe(2);
		expect(
			(await grai(dir, "import", "--from", "i18next", "i18n")).stdout,
		).toBe(
			[
				'left out: i18n/en.json: "ago" (en, de): {{p, uppercase}} formats the value as uppercase, which grai import does not convert. Write it with one of grai\'s formatting functions.',
				"grai: imported 1 key into messages/en.json, messages/de.json, and left 1 out",
				"grai: grai.import.json maps each key the source's calls name to its grai key, for grai migrate",
				"",
			].join("\n"),
		);
		expect(
			JSON.parse(readFileSync(join(dir, "messages", "de.json"), "utf8")),
		).toEqual({
			$schema: "https://inlang.com/schema/inlang-message-format",
			cart_title: "Warenkorb",
		});
	});
});

describe("grai migrate", () => {
	it("prints each call it left, then what it rewrote, and reads i18next's default namespace", async () => {
		const { dir } = project({ en: {}, de: {} });
		rmSync(join(dir, "messages"), { recursive: true });
		writeSources(dir, {
			"i18n/en/common.json": JSON.stringify({
				title: "Shop",
				hi: "Hi {{name}}",
			}),
			"i18n/de/common.json": JSON.stringify({
				title: "Laden",
				hi: "Hallo {{name}}",
			}),
			"i18n/en/cart.json": JSON.stringify({ title: "Cart" }),
			"i18n/de/cart.json": JSON.stringify({ title: "Warenkorb" }),
			"src/app.ts": [
				'import { t } from "i18next";',
				'export const title = t("title");',
				'export const cart = t("cart:title");',
				"export const hi = (key: string) => t(key);",
				"",
			].join("\n"),
		});
		await grai(dir, "import", "--from", "i18next", "i18n");

		const { code, stdout } = await grai(
			dir,
			"migrate",
			"--default-namespace",
			"common",
		);

		expect(code).toBe(0);
		expect(stdout).toBe(
			[
				"src/app.ts:4:36: its key is an expression: call the message by name, as m.<key>().",
				"grai: rewrote 2 calls in 1 file, and left 1, listed above",
				"",
			].join("\n"),
		);
		expect(readText(dir, "src/app.ts")).toContain(
			"export const title = m.common_title();\nexport const cart = m.cart_title();",
		);
	});
});

it("grai watch writes the output, then the shard a catalog's edit changes", async () => {
	const { dir } = project(catalogs);
	const child = spawn(process.execPath, [cli, "watch"], { cwd: dir });
	onTestFinished(() => {
		child.kill();
	});
	const lines = createInterface({ input: child.stdout })[
		Symbol.asyncIterator
	]();
	const next = async () => String((await lines.next()).value);

	expect(await next()).toBe("grai: watching grai.config.json and its catalogs");
	expect(await next()).toMatch(/^grai: wrote 13 files in out/);
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, cart_title: "Warenkorb" }, null, "\t"),
	);
	expect(await next()).toMatch(/^grai: wrote keys\/0\.js in out \(.+ ms\)$/);
});

it("prints the usage and exits with 2 for a command it does not know", async () => {
	const { dir } = project(catalogs);
	for (const name of ["build", "constructor", "toString"]) {
		const { code, stderr } = await grai(dir, name);

		expect(code).toBe(2);
		expect(stderr).toMatch(
			new RegExp(
				`^grai: there is no command "${name}"\n\nUsage: grai <command>`,
			),
		);
	}
});
