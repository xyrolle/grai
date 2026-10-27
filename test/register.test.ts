import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "./project.ts";

const register = new URL("../src/register.ts", import.meta.url).href;

/**
 * A compiled project whose package.json maps each key's path to keys.js, as an app does, with
 * `files` beside it by path.
 */
async function app(files: Record<string, string>) {
	const { dir, compile } = project({
		en: { title: "Title", greeting: "Hello {name}" },
		de: { title: "Titel", greeting: "Hallo {name}" },
	});
	expect((await compile()).errors).toEqual([]);
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			type: "module",
			imports: { "#i18n/messages/*": "./out/keys.js" },
		}),
	);
	for (const [path, code] of Object.entries(files)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), code);
	}
	return dir;
}

/**
 * Runs Node in `dir` with @xyrolle/grai/register loaded first, or without: its exit and its output.
 */
function node(dir: string, args: string[], { hooked = true } = {}) {
	const { status, stdout, stderr } = spawnSync(
		process.execPath,
		[...(hooked ? ["--import", register] : []), ...args],
		{ cwd: dir, encoding: "utf8" },
	);
	return { status, stdout, output: `${stdout}${stderr}` };
}

/**
 * Whether node:test's module mocks resolve through `module.registerHooks`: from Node 24.12 and
 * 25.1 (nodejs/node#60326). Before, they resolve in a loader thread these hooks never reach.
 */
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const mocksThroughHooks =
	major > 25 || (major === 25 && minor >= 1) || (major === 24 && minor >= 12);

describe("@xyrolle/grai/register", () => {
	it("gives each key's path a module of that key alone, and leaves keys.js and the app's own modules as they are", async () => {
		const dir = await app({
			"src/messages/own.js": `export const own = "the app's own";\n`,
			"main.js": `import * as title from "#i18n/messages/title.js";
import * as greeting from "#i18n/messages/greeting.js";
import * as keys from "./out/keys.js";
import { own } from "./src/messages/own.js";
console.log(JSON.stringify([Object.keys(title), Object.keys(greeting), Object.keys(keys), title.title({}, { locale: "de" }), greeting.greeting === keys.greeting, own]));
`,
		});

		const hooked = node(dir, ["main.js"]);
		expect(hooked.status, hooked.output).toBe(0);
		expect(JSON.parse(hooked.stdout)).toEqual([
			["title"],
			["greeting"],
			["greeting", "title"],
			"Titel",
			true,
			"the app's own",
		]);
		expect(
			JSON.parse(node(dir, ["main.js"], { hooked: false }).stdout)[0],
		).toEqual(["greeting", "title"]);
	});

	it.runIf(mocksThroughHooks)(
		"has node:test's mock.module of one key's path mock that key and no other",
		async () => {
			const dir = await app({
				"page.js": `import { title } from "#i18n/messages/title.js";
import { greeting } from "#i18n/messages/greeting.js";
export const render = () => [title(), greeting({ name: "Ana" })];
`,
				"page.test.js": `import assert from "node:assert";
import { mock, test } from "node:test";
mock.module("#i18n/messages/title.js", { namedExports: { title: () => "mocked" } });
const { render } = await import("./page.js");
test("mocks the title alone", () => {
	assert.deepEqual(render(), ["mocked", "Hello Ana"]);
});
`,
			});
			const args = [
				"--experimental-test-module-mocks",
				"--test",
				"page.test.js",
			];

			const hooked = node(dir, args);
			expect(hooked.status, hooked.output).toBe(0);
			expect(node(dir, args, { hooked: false }).status).not.toBe(0);
		},
	);

	it("fails the import of a key no catalog has, naming the key and what to do", async () => {
		const dir = await app({
			"main.js": `await import("#i18n/messages/absent.js").catch((error) => console.log(\`\${error.name} \${error.code}: \${error.message}\`));\n`,
		});

		expect(node(dir, ["main.js"]).stdout.trim()).toBe(
			'GraiError key-missing: "absent" is imported by its path, but no catalog has it. Add it to every catalog, or fix the import.',
		);
	});
});
