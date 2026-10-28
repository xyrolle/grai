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
import {
	conflictingInput,
	conflictingInputError,
	firstStart,
} from "./first-start.ts";
import { stopped } from "./stopped.ts";

// The Nuxt example (examples/nuxt), built by `nuxt build`, checked by `nuxt typecheck` against the
// package's built declarations and served by its Node server, by the URL prefix and then by the
// cookie and Accept-Language, then under `nuxt dev`; its pages in Chromium. One file, so that the dev suite's edits never reach a build.
const example = fileURLToPath(new URL("../examples/nuxt/", import.meta.url));
const nuxt = join(example, "node_modules/.bin/nuxt");
const outdir = join(example, "app/i18n");
/** No telemetry, which would phone home and outlive the test in a process of its own. */
const telemetry = { NUXT_TELEMETRY_DISABLED: "1" };

/** A server the suite started, and the origin it printed. */
type Served = { server: ChildProcess; origin: string };

/**
 * Starts `command` in the example on 127.0.0.1 and a port the system picks, so that runs of this
 * file side by side never meet, and resolves once it prints the address it listens on. It leads a
 * process group of its own, so that stopping it stops what it forks, as `nuxt dev` forks its server.
 */
async function listening(
	command: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<Served> {
	const server = spawn(command, args, {
		cwd: example,
		env: outsideTests({ ...telemetry, NO_COLOR: "1", ...env }),
		detached: true,
	});
	let printed = "";
	const origin = await new Promise<string>((resolve, reject) => {
		const read = (chunk: unknown) => {
			printed += String(chunk);
			const address = /http:\/\/127\.0\.0\.1:\d+/.exec(printed)?.[0];
			if (address !== undefined) resolve(address);
		};
		server.stdout?.on("data", read);
		server.stderr?.on("data", read);
		server.on("exit", (code) =>
			reject(new Error(`${command} exited: ${code}\n${printed}`)),
		);
	});
	return { server, origin };
}

/** Builds the example with a grai config, and serves the build with its Node server. */
function built(config = "grai.config.json"): Promise<Served> {
	const build = spawnSync(nuxt, ["build"], {
		cwd: example,
		env: outsideTests({ ...telemetry, GRAI_CONFIG: config }),
		encoding: "utf8",
	});
	if (build.status !== 0) {
		throw new Error(`nuxt build failed:\n${build.stdout}${build.stderr}`);
	}
	return listening("node", [".output/server/index.mjs"], {
		HOST: "127.0.0.1",
		PORT: "0",
	});
}

let browser: Browser;
let page: Page;
/** What the test's pages logged as an error or a warning, and the scripts they fetched. */
let logged: string[];
let scripts: string[];
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(() => browser?.close());
beforeEach(async () => {
	const context = await browser.newContext();
	page = await context.newPage();
	logged = [];
	scripts = [];
	context.on("console", (message) => {
		if (["error", "warning"].includes(message.type()))
			logged.push(message.text());
	});
	context.on("weberror", (error) => logged.push(error.error().message));
	context.on("request", (request) => {
		if (request.resourceType() === "script")
			scripts.push(new URL(request.url()).pathname);
	});
	onTestFinished(() => context.close());
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
	let origin = "";
	let app: Served | undefined;
	beforeAll(async () => {
		app = await built();
		origin = app.origin;
	}, 300_000);
	afterAll(() => app && stopped(app.server));

	it("typechecks against the package's built declarations, as an app's nuxt typecheck sees them", () => {
		const checked = spawnSync(nuxt, ["typecheck"], {
			cwd: example,
			env: outsideTests(telemetry),
			encoding: "utf8",
		});
		expect(checked.status, checked.stdout + checked.stderr).toBe(0);
	}, 120_000);

	it("server-renders each locale in its words, routed by its prefix, and hydrates each in them without a mismatch, loading only its words", async () => {
		const pages = [
			["/", "en", "ltr", "A shop that speaks your language"],
			["/ro", "ro", "ltr", "Un magazin care îți vorbește limba"],
			["/ar", "ar", "rtl", "متجر يتحدث لغتك"],
		];
		for (const [path, lang, dir, title] of pages) {
			const served = await fetch(origin + path).then((page) => page.text());
			expect(served).toMatch(
				new RegExp(`<html[^>]* lang="${lang}" dir="${dir}"`),
			);
			expect(served).toContain(`<h1>${title}</h1>`);

			// Each locale in a page of its own: a page fetches the words of the pages it links to once
			// it is idle, which can be after the next page is asked for, until it is closed.
			const context = page.context();
			await page.close();
			page = await context.newPage();
			scripts = [];
			await page.goto(origin + path);
			await page.locator("#hydrated").waitFor();
			const words = scripts.filter((script) =>
				/^\/_nuxt\/grai(-[^/]+)?\//.test(script),
			);

			expect(await text("h1")).toBe(title);
			expect(words.length).toBeGreaterThan(0);
			expect(
				words.filter((script) => !script.startsWith(`/_nuxt/grai-${lang}/`)),
			).toEqual([]);
		}
		// Vue logs a mismatch it repaired, even in a production build.
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

describe("the Nuxt example, built, by every locale's prefix, then the cookie and Accept-Language", {
	timeout: 30_000,
}, () => {
	let origin = "";
	let app: Served | undefined;
	beforeAll(async () => {
		app = await built("grai.always.json");
		origin = app.origin;
	}, 300_000);
	afterAll(() => app && stopped(app.server));

	it("sends a page asked for without a prefix to the cookie's locale's own prefix, and varies by the headers the strategy reads", async () => {
		const sent = await fetch(`${origin}/about`, {
			headers: { cookie: "lang=ro" },
			redirect: "manual",
		});
		await page
			.context()
			.addCookies([{ name: "lang", value: "ro", url: origin }]);
		const response = await page.goto(`${origin}/about`);

		expect([
			sent.status,
			sent.headers.get("location"),
			sent.headers.get("vary"),
		]).toEqual([307, `${origin}/romana/about`, "Cookie, Accept-Language"]);
		expect(page.url()).toBe(`${origin}/romana/about`);
		expect(await html("lang")).toBe("ro");
		expect(await text("h1")).toBe("Despre magazin");
		expect(response?.headers().vary).toContain("Cookie, Accept-Language");
	});

	it("sends it to the browser's language when no cookie names one", async () => {
		const ar = await browser.newPage({ locale: "ar-EG" });
		onTestFinished(() => ar.context().close());
		await ar.goto(`${origin}/`);

		expect(ar.url()).toBe(`${origin}/ar`);
		expect(await ar.locator("html").getAttribute("lang")).toBe("ar");
		expect(await ar.locator("html").getAttribute("dir")).toBe("rtl");
	});

	it("renders the base locale under its prefix, and navigates in place under it", async () => {
		await page.goto(`${origin}/en`);
		await page.locator("#hydrated").waitFor();
		await mark();

		await page.click("#about");
		await page.waitForURL(`${origin}/en/about`);

		expect(await html("lang")).toBe("en");
		expect(await text("h1")).toBe("About the shop");
		expect(await marked()).toBe(true);
		expect(logged).toEqual([]);
	});
});

/** Starts `nuxt dev` on the example, on a port the system picks. */
const nuxtDev = () =>
	listening(nuxt, ["dev", "--port", "0", "--host", "127.0.0.1"]);

describe("the Nuxt example under nuxt dev", { timeout: 60_000 }, () => {
	let origin = "";
	let app: Served | undefined;
	beforeAll(async () => {
		// A first start: the module compiles in its setup, and the browser's dev modules come from the
		// plugin's first compile, served before its output is written.
		firstStart(outdir);
		app = await nuxtDev();
		origin = app.origin;
	}, 120_000);
	afterAll(() => app && stopped(app.server));

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

	it("loads each page's locale's words alone, the locale the server drew it in", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();

		expect(await html("lang")).toBe("ro");
		expect(scripts.filter((path) => path.includes("grai:keys"))).toEqual([
			"/_nuxt/@id/__x00__grai:keys/ro",
		]);
	});

	it("renders an edited message again in place, keeping the page's state, and the server's renders take it too", async () => {
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
		// Nuxt's server runs in a Vite server of its own, which takes the edit once its watcher sees
		// the output's files change: that can be just after the page has patched itself.
		await expect
			.poll(() => fetch(`${origin}/ro/`).then((served) => served.text()), {
				timeout: 10_000,
			})
			.toContain("Un magazin pe limba ta");
	});
});

describe("the Nuxt example under nuxt dev, a message invalid in a locale no page loads", {
	timeout: 120_000,
}, () => {
	it("serves no page's words, the page's locale's neither", async () => {
		// Nuxt's server renders from the output on disk, which a compile that failed leaves as it was.
		const file = join(example, "messages", "ar.json");
		const catalog = readFileSync(file, "utf8");
		onTestFinished(() => writeFileSync(file, catalog));
		writeFileSync(
			file,
			JSON.stringify(
				{ ...JSON.parse(catalog), title: "{$count :weekday}" },
				null,
				"\t",
			),
		);
		const app = await nuxtDev();
		onTestFinished(() => stopped(app.server));
		const keys = () => fetch(`${app.origin}/_nuxt/@id/__x00__grai:keys/ro`);
		// nuxi answers 503 until its first build of the app is done.
		await expect
			.poll(async () => (await keys()).status, { timeout: 60_000 })
			.not.toBe(503);
		const every = await fetch(`${app.origin}/_nuxt/@id/__x00__grai:keys`);

		expect([(await keys()).ok, every.ok]).toEqual([false, false]);
	});
});

describe("the Nuxt example under nuxt dev, a first start with an error only the output's write finds", {
	timeout: 60_000,
}, () => {
	let origin = "";
	let app: Served | undefined;
	let restore = () => {};
	beforeAll(async () => {
		restore = conflictingInput(join(example, "messages"));
		// After an upgrade: Nuxt's server reads the output's files, which the module's compile, failing
		// on the error, leaves as an earlier grai wrote them; from a fresh clone it has none to read.
		firstStart(outdir, { kept: true });
		app = await nuxtDev();
		origin = app.origin;
	}, 120_000);
	afterAll(async () => {
		if (app) await stopped(app.server);
		restore();
	});

	it("hydrates the first page in its locale, then sends it the error, which Nuxt's overlay shows", async () => {
		await page.goto(`${origin}/ro/`);
		await page.locator("#hydrated").waitFor();
		expect(await html("lang")).toBe("ro");
		// Nuxt shows a dev error in an overlay of its own, and Vite's client logs it.
		await expect
			.poll(() => logged.join("\n"), { timeout: 20_000 })
			.toContain(conflictingInputError);
	});
});
