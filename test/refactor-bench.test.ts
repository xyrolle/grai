import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { project } from "./project.ts";

const refactor = fileURLToPath(
	new URL("../bench/refactor.mjs", import.meta.url),
);

/** One timed run of a refactoring command, in a process of its own, as the bench makes it. */
function timedRun(
	command: string,
	...args: string[]
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((done, failed) => {
		execFile(
			process.execPath,
			[refactor, "--child", command, ...args],
			(error, stdout, stderr) =>
				error === null ? done({ stdout, stderr }) : failed(error),
		);
	});
}

describe("the refactoring bench", () => {
	it("times check --fix as the command runs, the check after the removal included", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart", cart_old: "Old" },
			de: { cart_title: "Ihr Warenkorb", cart_old: "Alt" },
		});
		// A call of a key no catalog has, which only the check reports.
		writeFileSync(
			join(dir, "app.ts"),
			'import { m } from "./out/messages.js";\nm.cart_title();\nm.cart_gone();\n',
		);

		const { stdout, stderr } = await timedRun("fix", config);

		expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "")).toEqual({
			ms: expect.any(Number),
			code: 1,
		});
		expect(stdout).toContain('removed: "cart_old" from every catalog');
		expect(stderr).toContain("m.cart_gone names a key no catalog has");
		const catalog = readFileSync(join(dir, "messages", "en.json"), "utf8");
		expect(Object.keys(JSON.parse(catalog))).toEqual(["cart_title"]);
	});
});
