import { execFile } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { project } from "./project.ts";

const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));
const vitest = join(nodeModules, "vitest", "vitest.mjs");
const plugin = fileURLToPath(new URL("../src/vite.ts", import.meta.url));

/** The environment of a Vitest run of its own, without this run's variables. */
const ownEnvironment = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
);

describe("the Vite plugin under Vitest", { timeout: 60_000 }, () => {
	it("gives each key's path a module of its own, so a test mocks one key and no other", async () => {
		const { dir } = project({
			en: { title: "Title", footer: "Footer" },
			de: { title: "Titel", footer: "Fußzeile" },
		});
		symlinkSync(nodeModules, join(dir, "node_modules"));
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				type: "module",
				imports: { "#i18n/messages/*": "./out/keys.js" },
			}),
		);
		writeFileSync(
			join(dir, "vitest.config.js"),
			`import { grai } from ${JSON.stringify(plugin)};\nexport default { plugins: [grai()] };\n`,
		);
		writeFileSync(
			join(dir, "mock.test.js"),
			`import { expect, test, vi } from "vitest";
import { footer } from "#i18n/messages/footer.js";
import { title } from "#i18n/messages/title.js";
vi.mock("#i18n/messages/title.js", () => ({ title: () => "Mocked" }));
test("one key mocked", () => {
	expect([title(), footer()]).toEqual(["Mocked", "Footer"]);
});
`,
		);

		const run = await promisify(execFile)(
			process.execPath,
			[vitest, "run", "--root", dir],
			{ cwd: dir, env: ownEnvironment },
		).catch((error: { stdout: string }) => error);

		expect(run.stdout).toContain("1 passed");
	});
});
