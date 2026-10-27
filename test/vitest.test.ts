import { execFile } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";
import { project } from "./project.ts";

const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));
const vitest = join(nodeModules, "vitest", "vitest.mjs");
const plugin = fileURLToPath(new URL("../src/vite.ts", import.meta.url));

/** The environment of a Vitest run of its own, without this run's variables. */
const ownEnvironment = { ...process.env };
for (const name of Object.keys(ownEnvironment)) {
	if (name.startsWith("VITEST")) delete ownEnvironment[name];
}

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

	it("mocks one key in a Next app, whose Vitest config lists grai's plugin as it has no Vite config", async () => {
		// The Next example as an app has it, its packages installed, with a Vitest config and a test of
		// its own: @xyrolle/grai/vite from the package, as the app imports it, which the build put in
		// dist.
		const example = fileURLToPath(
			new URL("../examples/next/", import.meta.url),
		);
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-next-vitest-")));
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
		cpSync(example, dir, {
			recursive: true,
			filter: (source) =>
				!/\/(node_modules|\.next|src\/i18n)(\/|$)/.test(source),
		});
		symlinkSync(join(example, "node_modules"), join(dir, "node_modules"));
		writeFileSync(
			join(dir, "vitest.config.ts"),
			`import { grai } from "@xyrolle/grai/vite";\nimport { defineConfig } from "vitest/config";\n\nexport default defineConfig({ plugins: [grai()] });\n`,
		);
		writeFileSync(
			join(dir, "about.test.ts"),
			`import { expect, test, vi } from "vitest";
import { about_body } from "#i18n/messages/about_body.js";
import { about_title } from "#i18n/messages/about_title.js";
import * as m from "./src/i18n/keys.js";
vi.mock("#i18n/messages/about_title.js", () => ({ about_title: () => "Mocked" }));
test("one key mocked, the others the catalog's", () => {
	expect([about_title(), about_body({}, { locale: "en" }), m.about_title({}, { locale: "en" })]).toEqual([
		"Mocked",
		"We ship everywhere, in your language.",
		"About the shop",
	]);
});
`,
		);

		const run = await promisify(execFile)(
			process.execPath,
			[vitest, "run", "--root", dir],
			{ cwd: dir, env: ownEnvironment },
		).catch((error: { stdout: string; stderr: string }) => error);

		expect(run.stdout, run.stderr).toContain("1 passed");
	});
});
