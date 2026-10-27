import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { project } from "./project.ts";
import { readText, writeSources } from "./sources.ts";

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

/** What check reports, by message. */
async function reported(config: string): Promise<string[]> {
	return (await check(config)).problems.map(({ message }) => message);
}

describe("grai check of the imports of keys from keys.js", () => {
	it("reports an import of keys by name from keys.js, where package.json gives each key its own path, and no other import of the output", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"src/page.ts": [
				'import { cart_title, cart_greeting as greet } from "../out/keys.js";',
				'cart_title(); greet({ name: "Ana" });',
				"",
			].join("\n"),
			"src/whole.ts": 'import * as m from "../out/keys.js";\nm.cart_title();\n',
			"src/passes.ts": 'export { cart_title } from "../out/keys.js";\n',
			"src/own.ts":
				'import { cart_greeting } from "#i18n/messages/cart_greeting.js";\ncart_greeting({ name: "Ana" });\n',
		});

		expect(await reported(config)).toEqual([
			'src/page.ts:1:52: imports cart_title, cart_greeting from keys.js, though package.json gives each key its own path: a mock of "#i18n/messages/cart_title.js" reaches only the files that import the key by that path. Import each from its own path, as grai check --fix does.',
		]);
	});

	it("reports none where package.json gives no key a path of its own", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"package.json": JSON.stringify({ type: "module" }),
			"src/page.ts":
				'import { cart_title, cart_greeting } from "../out/keys.js";\ncart_title(); cart_greeting({ name: "Ana" });\n',
		});

		expect(await reported(config)).toEqual([]);
	});

	it("writes a key's path as the package.json pattern does, its extension in the pattern", async () => {
		const { dir, config } = project(catalogs);
		writeSources(dir, {
			"package.json": JSON.stringify({
				type: "module",
				imports: { "#i18n/messages/*.js": "./out/keys.js" },
			}),
			"src/page.ts":
				'import { cart_greeting, cart_title } from "../out/keys.js";\ncart_title(); cart_greeting({ name: "Ana" });\n',
		});

		expect(await reported(config)).toEqual([
			'src/page.ts:1:43: imports cart_greeting, cart_title from keys.js, though package.json gives each key its own path: a mock of "#i18n/messages/cart_greeting.js" reaches only the files that import the key by that path. Import each from its own path, as grai check --fix does.',
		]);
	});
});

describe("grai check --fix of the imports of keys from keys.js", () => {
	it("imports each key from its own path, keeping a type import, the name it binds, the quotes and the semicolons, then checks", async () => {
		const { dir } = project(catalogs);
		writeSources(dir, {
			"src/page.ts": [
				'import { cart_title, cart_greeting as greet } from "../out/keys.js";',
				'cart_title(); greet({ name: "Ana" });',
				"",
			].join("\n"),
			"src/types.ts": [
				"import type { cart_title } from '../out/keys.js'",
				"export type Title = typeof cart_title",
				"",
			].join("\n"),
			"src/mixed.ts": [
				'import { type cart_greeting, cart_title } from "../out/keys.js";',
				"export type Greeting = typeof cart_greeting;",
				"cart_title();",
				"",
			].join("\n"),
			"src/Cart.svelte": [
				"<script>",
				'\timport { cart_title, cart_greeting } from "../out/keys.js";',
				"</script>",
				'<h1>{cart_title()}</h1><p>{cart_greeting({ name: "Ana" })}</p>',
				"",
			].join("\n"),
			"src/noted.ts": [
				'import { cart_title /* the heading */ } from "../out/keys.js";',
				"cart_title();",
				"",
			].join("\n"),
		});

		const fixed = await grai(dir, "check", "--fix");

		expect(fixed.code).toBe(1);
		expect(fixed.stdout).toBe(
			[
				"moved: src/Cart.svelte:2:44: cart_title, cart_greeting, each to its own path",
				"moved: src/mixed.ts:1:48: cart_greeting, cart_title, each to its own path",
				"moved: src/page.ts:1:52: cart_title, cart_greeting, each to its own path",
				"moved: src/types.ts:1:33: cart_title, each to its own path",
				"",
			].join("\n"),
		);
		expect(fixed.stderr).toBe(
			'src/noted.ts:1:46: imports cart_title from keys.js, though package.json gives each key its own path: a mock of "#i18n/messages/cart_title.js" reaches only the files that import the key by that path. Import each from its own path, as grai check --fix does.\ngrai: 1 error\n',
		);
		expect(readText(dir, "src/page.ts")).toBe(
			[
				'import { cart_title } from "#i18n/messages/cart_title.js";',
				'import { cart_greeting as greet } from "#i18n/messages/cart_greeting.js";',
				'cart_title(); greet({ name: "Ana" });',
				"",
			].join("\n"),
		);
		expect(readText(dir, "src/types.ts")).toBe(
			[
				"import type { cart_title } from '#i18n/messages/cart_title.js'",
				"export type Title = typeof cart_title",
				"",
			].join("\n"),
		);
		expect(readText(dir, "src/mixed.ts")).toBe(
			[
				'import type { cart_greeting } from "#i18n/messages/cart_greeting.js";',
				'import { cart_title } from "#i18n/messages/cart_title.js";',
				"export type Greeting = typeof cart_greeting;",
				"cart_title();",
				"",
			].join("\n"),
		);
		expect(readText(dir, "src/Cart.svelte")).toBe(
			[
				"<script>",
				'\timport { cart_title } from "#i18n/messages/cart_title.js";',
				'\timport { cart_greeting } from "#i18n/messages/cart_greeting.js";',
				"</script>",
				'<h1>{cart_title()}</h1><p>{cart_greeting({ name: "Ana" })}</p>',
				"",
			].join("\n"),
		);
		expect(readText(dir, "src/noted.ts")).toBe(
			[
				'import { cart_title /* the heading */ } from "../out/keys.js";',
				"cart_title();",
				"",
			].join("\n"),
		);
	});

	it("moves nothing where package.json gives no key a path of its own", async () => {
		const { dir } = project(catalogs);
		const page =
			'import { cart_title, cart_greeting } from "../out/keys.js";\ncart_title(); cart_greeting({ name: "Ana" });\n';
		writeSources(dir, { "src/page.ts": page });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ type: "module" }),
		);

		expect(await grai(dir, "check", "--fix")).toEqual({
			code: 0,
			stdout: "grai: no problems\n",
			stderr: "",
		});
		expect(readText(dir, "src/page.ts")).toBe(page);
	});
});
