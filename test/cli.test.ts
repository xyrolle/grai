import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { project } from "./project.ts";

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
			/^grai: wrote 9 files in out \(.+ ms\)\n$/,
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
				'messages/de.json: "cart_greeting" (de): the message never reads {name}, which en reads. Read it here too, or drop it everywhere.',
				'messages/en.json: "cart_title": no source file under . names the key. Remove it from every catalog, or use it.',
				"grai: 2 errors",
				"",
			].join("\n"),
		);
		expect(existsSync(join(dir, "out"))).toBe(false);
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
		expect(stdout).toMatch(/^grai: wrote 9 files in out/);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(
			JSON.stringify({ ...catalogs.de, cart_empty: "Leer" }, null, "\t"),
		);
	});

	it("writes nothing without every locale's text, for a key that exists, or for an invalid text", async () => {
		const { dir } = project(catalogs);
		const before = readFileSync(join(dir, "messages", "de.json"), "utf8");
		const attempts = [
			await grai(dir, "add", "cart_empty", "--en", "Empty"),
			await grai(dir, "add", "cart_title", "--en", "Title", "--de", "Titel"),
			await grai(
				dir,
				"add",
				"cart_total",
				"--en",
				"Total {sum: number}",
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
				'messages/en.json: "cart_total" (en): the placeholder {sum: number} calls a function, which grai does not support yet. Write the value as {name} and format it before the call.',
			],
		]);
		expect(readFileSync(join(dir, "messages", "de.json"), "utf8")).toBe(before);
		expect(existsSync(join(dir, "out"))).toBe(false);
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
	expect(await next()).toMatch(/^grai: wrote 9 files in out/);
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, cart_title: "Warenkorb" }, null, "\t"),
	);
	expect(await next()).toMatch(/^grai: wrote keys\/0\.js in out \(.+ ms\)$/);
});

it("prints the usage and exits with 2 for a command it does not know", async () => {
	const { dir } = project(catalogs);
	const { code, stderr } = await grai(dir, "build");

	expect(code).toBe(2);
	expect(stderr).toMatch(
		/^grai: there is no command "build"\n\nUsage: grai <command>/,
	);
});
