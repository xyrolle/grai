/// <reference lib="dom" />
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { aroundEach, describe, expect, it, onTestFinished } from "vitest";
import { type Messages, project } from "./project.ts";

/**
 * A page in jsdom, as an app's component tests have one, its `<html lang>` empty: the output loaded
 * after it renders in the base locale, as a page the server drew in it.
 */
function jsdomPage(): Document {
	const { window } = new JSDOM("<!doctype html><html><body></body></html>");
	globalThis.document = window.document;
	onTestFinished(() => {
		Reflect.deleteProperty(globalThis, "document");
		window.close();
	});
	return window.document;
}

/** A component as an app writes one: it draws a message in the locale its props name. */
function title(m: Messages, target: HTMLElement, props: { locale: string }) {
	target.textContent = m.title?.({}, { locale: props.locale }) ?? "";
}

it("renders a component in a locale other than the page's in jsdom, once the test binds it with useLocale", async () => {
	const page = jsdomPage();
	const { dir, load } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const { m } = await load();
	const { useLocale } = await import(
		pathToFileURL(join(dir, "out", "testing.js")).href
	);
	const target = page.createElement("main");

	// A page loaded in the base locale refuses another, as a production page does.
	expect(() => title(m, target, { locale: "de" })).toThrow(
		expect.objectContaining({ code: "locale-not-loaded" }),
	);

	useLocale("de");
	title(m, target, { locale: "de" });

	expect(target.textContent).toBe("Ihr Warenkorb");
	expect(m.title?.()).toBe("Ihr Warenkorb");
	expect(page.documentElement.lang).toBe("de");
});

/** A project in English and German, loaded as a process whose middleware binds requests. */
async function served() {
	const { dir, load } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const { m } = await load();
	const output = (file: string) =>
		import(pathToFileURL(join(dir, "out", file)).href);
	return {
		m,
		server: await output("server.js"),
		testing: await output("testing.js"),
	};
}

it("binds with useLocale a page's or a script's locale, which a process that serves requests renders in nowhere", async () => {
	const { m, testing } = await served();

	testing.useLocale("de");

	expect(() => m.title?.()).toThrow(
		expect.objectContaining({ code: "locale-unbound" }),
	);
});

describe("a test in a process that serves requests, bound with server.js's withLocale around it", () => {
	let m: Messages = {};
	aroundEach(async (test) => {
		const loaded = await served();
		m = loaded.m;
		await loaded.server.withLocale("de", test);
	});

	it("renders in that locale, in its synchronous code and after an await", async () => {
		const first = m.title?.();
		await new Promise((resolve) => setTimeout(resolve));

		expect([first, m.title?.()]).toEqual(["Ihr Warenkorb", "Ihr Warenkorb"]);
	});
});

/**
 * Runs a project's test file in Vitest's browser mode, in Chromium, with grai's plugin, in a process
 * of its own, as an app's component tests run, in Vitest's own mode or the one given: each test's
 * name and state, with its errors.
 */
function inVitestBrowser(dir: string, test: string, mode?: string) {
	// The project's imports of Vitest resolve to this repository's.
	symlinkSync(
		fileURLToPath(new URL("../node_modules", import.meta.url)),
		join(dir, "node_modules"),
		"junction",
	);
	writeFileSync(join(dir, "locale.test.js"), test);
	const script = `
const { startVitest } = await import("vitest/node");
const { playwright } = await import("@vitest/browser-playwright");
const { grai } = await import(${JSON.stringify(new URL("../src/vite.ts", import.meta.url).href)});
const vitest = await startVitest("test", [], {
	root: process.cwd(),
	config: false,${mode === undefined ? "" : `\n\tmode: ${JSON.stringify(mode)},`}
	watch: false,
	reporters: [],
	browser: {
		enabled: true,
		headless: true,
		provider: playwright(),
		instances: [{ browser: "chromium" }],
		api: { port: 0 },
	},
}, { plugins: [grai()] });
await vitest.close();
const tests = vitest.state.getFiles().flatMap((file) => file.tasks);
console.log(JSON.stringify(tests.map((test) => ({ name: test.name, state: test.result?.state, errors: test.result?.errors?.map((error) => error.message) ?? [] }))));
`;
	// Vitest's own variables would have the run take itself for this test's worker.
	const env = { ...process.env };
	for (const name of Object.keys(env))
		if (name.startsWith("VITEST")) Reflect.deleteProperty(env, name);
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script],
		{ cwd: dir, env, encoding: "utf8" },
	);
	const last = run.stdout.trim().split("\n").at(-1);
	const results: unknown = last?.startsWith("[")
		? JSON.parse(last)
		: { failed: run.stderr };
	return results;
}

it("renders in each locale useLocale binds in Vitest's browser mode, where the plugin's dev server serves the messages", {
	timeout: 60_000,
}, () => {
	const { dir } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const results = inVitestBrowser(
		dir,
		`import { expect, test } from "vitest";
import { m } from "./out/messages.js";
import { useLocale } from "./out/testing.js";

test("switches", () => {
	useLocale("en");
	expect(m.title()).toBe("Your cart");
	useLocale("de");
	expect(m.title()).toBe("Ihr Warenkorb");
	useLocale("en");
	expect(m.title()).toBe("Your cart");
});
`,
	);

	expect(results).toEqual([{ name: "switches", state: "pass", errors: [] }]);
});

describe("Vitest's browser mode in a mode of its own, as a project's config gives it", {
	timeout: 60_000,
}, () => {
	/** A test that marks that it ran, and reads a file of the output, which only its write makes. */
	const marking = `import { expect, test } from "vitest";
import { commands } from "vitest/browser";
import { m } from "./out/messages.js";

test("written", async () => {
	await commands.writeFile("./ran", "");
	expect(await commands.readFile("./out/keys.d.ts")).toContain("./keys/");
	expect(m.title()).toBe("Your cart");
});
`;

	it("writes the output before a test takes the messages", () => {
		const { dir } = project({
			en: { title: "Your cart" },
			de: { title: "Ihr Warenkorb" },
		});

		expect(inVitestBrowser(dir, marking, "development")).toEqual([
			{ name: "written", state: "pass", errors: [] },
		]);
	});

	it("runs no test of a project whose catalogs fail the output's write", () => {
		const { dir } = project({
			en: { title: "Your cart", listed: "{x :list}" },
			de: { title: "Ihr Warenkorb", listed: "{x :number}" },
		});

		const results = inVitestBrowser(dir, marking, "development");

		expect(results).not.toContainEqual(
			expect.objectContaining({ state: "pass" }),
		);
		expect(existsSync(join(dir, "ran"))).toBe(false);
	});
});
