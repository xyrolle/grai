import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

it("prints the usage and exits with 2 for a command it does not know", async () => {
	const { dir } = project(catalogs);
	const { code, stderr } = await grai(dir, "build");

	expect(code).toBe(2);
	expect(stderr).toMatch(
		/^grai: there is no command "build"\n\nUsage: grai <command>/,
	);
});
