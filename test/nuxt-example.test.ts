import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
} from "vitest";
import { outsideTests } from "./app-environment.ts";

// The Nuxt example (examples/nuxt), built by `nuxt build`, checked by `nuxt typecheck` against the
// package's built declarations and served by its Node server, by the URL prefix and then by the
// cookie and Accept-Language, then under `nuxt dev`; its pages in Chromium. One file, so that the dev suite's edits never reach a build.
const example = fileURLToPath(new URL("../examples/nuxt/", import.meta.url));
const nuxt = join(example, "node_modules/.bin/nuxt");
/** No telemetry, which would phone home and outlive the test in a process of its own. */
const telemetry = { NUXT_TELEMETRY_DISABLED: "1" };

/** Starts `command` in the example until the suite ends, once it prints `ready`. */
function started(command: string, args: string[], ready: RegExp, extra = {}) {
	let server: ChildProcess | undefined;
	beforeAll(async () => {
		const child = spawn(command, args, {
			cwd: example,
			env: outsideTests({ ...telemetry, ...extra }),
		});
		server = child;
		let output = "";
		await new Promise<void>((resolve, reject) => {
			const read = (chunk: unknown) => {
				output += String(chunk);
				if (ready.test(output)) resolve();
			};
			child.stdout.on("data", read);
			child.stderr.on("data", read);
			child.on("exit", (code) =>
				reject(new Error(`${command} exited: ${code}\n${output}`)),
			);
		});
	}, 120_000);
	afterAll(() => {
		server?.kill();
	});
}

/** Builds the example with a grai config, and serves the build on `port` until the suite ends. */
function built(port: number, config = "grai.config.json"): void {
	beforeAll(() => {
		const build = spawnSync(nuxt, ["build"], {
			cwd: example,
			env: outsideTests({ ...telemetry, GRAI_CONFIG: config }),
			encoding: "utf8",
		});
		if (build.status !== 0) {
			throw new Error(`nuxt build failed:\n${build.stdout}${build.stderr}`);
		}
	}, 180_000);
	started("node", [".output/server/index.mjs"], /Listening on/, {
		PORT: String(port),
	});
}

let browser: Browser;
let page: Page;
/** What the page logged as an error or a warning, and the scripts it fetched. */
let logged: string[];
let scripts: string[];
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(() => browser?.close());
beforeEach(async () => {
	page = await browser.newPage();
	logged = [];
	scripts = [];
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type()))
			logged.push(message.text());
	});
	page.on("pageerror", (error) => logged.push(error.message));
	page.on("request", (request) => {
		if (request.resourceType() === "script")
			scripts.push(new URL(request.url()).pathname);
	});
	onTestFinished(() => page.context().close());
});

const text = (selector: string) => page.locator(selector).textContent();
const html = (attribute: "lang" | "dir") =>
	page.locator("html").getAttribute(attribute);
/** Marks the document, so a test tells a navigation in place from a page load. */
const mark = () =>
	page.evaluate(() => Object.assign(globalThis, { marked: true }));
const marked = () => page.evaluate(() => "marked" in globalThis);

describe("the Nuxt example, built, by the URL prefix", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4822";
	built(4822);

	it("typechecks against the package's built declarations, as an app's nuxt typecheck sees them", () => {
		const checked = spawnSync(nuxt, ["typecheck"], {
			cwd: example,
			env: outsideTests(telemetry),
			encoding: "utf8",
		});
		expect(checked.status, checked.stdout + checked.stderr).toBe(0);
	}, 120_000);

	it("renders the base locale unprefixed, and hydrates in it without an error", async () => {
		await page.goto(`${origin}/`);
		await page.locator("#hydrated").waitFor();

		expect(await html("lang")).toBe("en");
		expect(await html("dir")).toBe("ltr");
		expect(await text("h1")).toBe("A shop that speaks your language");
		expect(await text("#hydrated")).toBe("Drawn in the browser");
		expect(logged).toEqual([]);
	});

	it("renders a prefixed locale, with its plurals and markup, and hydrates in it", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();

		expect(await html("lang")).toBe("ro");
		expect(await text("#cart")).toBe("1 produs în coș");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");
		expect(await text("#terms a")).toBe("condițiile");
		expect(await text("#hydrated")).toBe("Desenat în browser");
		expect(logged).toEqual([]);
	});

	it("writes the direction of a right-to-left locale's script", async () => {
		await page.goto(`${origin}/ar/`);

		expect(await html("lang")).toBe("ar");
		expect(await html("dir")).toBe("rtl");
		expect(await text("h1")).toBe("متجر يتحدث لغتك");
	});

	it("loads only the page's locale's message chunks", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();

		const fetched = (directory: string) =>
			scripts.filter((path) => path.startsWith(`/_nuxt/${directory}/`));
		expect(fetched("grai-ro").length).toBeGreaterThan(0);
		expect([
			...fetched("grai"),
			...fetched("grai-en"),
			...fetched("grai-ar"),
		]).toEqual([]);
	});

	it("navigates in place within a locale, and the page's head takes its words", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();
		await mark();

		await page.click("#about");
		await page.waitForURL(`${origin}/ro/about`);

		expect(await text("h1")).toBe("Despre magazin");
		expect(await page.title()).toBe("Despre magazin");
		expect(await marked()).toBe(true);
		expect(logged).toEqual([]);
	});

	it("loads the page anew when a link leads into another locale", async () => {
		await page.goto(`${origin}/`);
		await page.locator("#hydrated").waitFor();
		await mark();

		const loaded = page.waitForEvent("load");
		await page.click('a[hreflang="ro"]');
		await loaded;

		expect(page.url()).toBe(`${origin}/ro`);
		expect(await text("h1")).toBe("Un magazin care îți vorbește limba");
		expect(await marked()).toBe(false);
	});

	it("renders interleaved requests each in its own locale, after a page's await", async () => {
		const pages = new Map([
			["/delivery", ["When your order arrives", "It arrives in 3 days."]],
			["/ro/delivery", ["Când sosește comanda", "Sosește în 3 zile."]],
			["/ar/delivery", ["متى يصل طلبك", "يصل خلال 3 أيام."]],
		]);
		const requests = Array.from({ length: 8 }, () => [...pages]).flat();
		const served = await Promise.all(
			requests.map(([path]) =>
				fetch(origin + path).then((page) => page.text()),
			),
		);

		const every = [...pages.values()].flat();
		expect(
			served.map((html) => every.filter((words) => html.includes(words))),
		).toEqual(requests.map(([, words]) => words));
	});
});

describe("the Nuxt example, built, by the cookie and Accept-Language", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4822";
	built(4822, "grai.cookie.json");

	it("renders in the cookie's locale, unprefixed, and varies by the headers the strategy reads", async () => {
		await page
			.context()
			.addCookies([{ name: "lang", value: "ro", url: origin }]);
		const response = await page.goto(`${origin}/about`);

		expect(await html("lang")).toBe("ro");
		expect(await text("h1")).toBe("Despre magazin");
		expect(response?.headers().vary).toContain("Cookie, Accept-Language");
	});

	it("renders in the browser's language when no cookie names one", async () => {
		const ar = await browser.newPage({ locale: "ar-EG" });
		onTestFinished(() => ar.context().close());
		await ar.goto(`${origin}/`);

		expect(await ar.locator("html").getAttribute("lang")).toBe("ar");
		expect(await ar.locator("html").getAttribute("dir")).toBe("rtl");
	});
});

describe("the Nuxt example under nuxt dev", { timeout: 60_000 }, () => {
	const origin = "http://localhost:4823";
	started(nuxt, ["dev", "--port", "4823"], /Local:/);

	/** Writes `text` as the Romanian title, and puts the catalog back after the test. */
	function editTitle(title: string): void {
		const file = join(example, "messages/ro.json");
		const catalog = readFileSync(file, "utf8");
		onTestFinished(() => writeFileSync(file, catalog));
		writeFileSync(
			file,
			JSON.stringify({ ...JSON.parse(catalog), title }, null, "\t"),
		);
	}

	it("renders an edited message again in place, keeping the page's state, and the server renders it next", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		await mark();

		editTitle("Un magazin pe limba ta");
		await page
			.getByRole("heading", { name: "Un magazin pe limba ta" })
			.waitFor();

		expect(await marked()).toBe(true);
		expect(await text("#cart")).toBe("2 produse în coș");
		const served = await fetch(`${origin}/ro/`).then((page) => page.text());
		expect(served).toContain("Un magazin pe limba ta");
	});
});
