import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

// The Vue example (examples/vue): built by Vite, checked by vue-tsc against the package's built
// declarations and served by its own server, then under Vite's dev server, its pages in Chromium.
// One file, so that the dev suite's edits never reach a build.
const example = fileURLToPath(new URL("../examples/vue/", import.meta.url));
const vite = join(example, "node_modules/.bin/vite");
const vueTsc = join(example, "node_modules/.bin/vue-tsc");
const outdir = join(example, "src/i18n");

/** A server the suite started, and the origin it printed. */
type Served = { server: ChildProcess; origin: string };

/**
 * Starts the example's server, `node server.ts` with `args`, on a port the system picks, so that
 * runs of this file side by side never meet, and resolves once it prints the address it listens
 * on. It leads a process group of its own, which `stopped` stops.
 */
async function served(args: string[] = []): Promise<Served> {
	const server = spawn("node", ["server.ts", ...args], {
		cwd: example,
		env: outsideTests({ PORT: "0" }),
		detached: true,
	});
	let printed = "";
	const origin = await new Promise<string>((resolve, reject) => {
		server.stdout?.on("data", (chunk) => {
			printed += String(chunk);
			const address = /http:\/\/localhost:\d+/.exec(printed)?.[0];
			if (address !== undefined) resolve(address);
		});
		server.on("exit", (code) =>
			reject(new Error(`the example's server exited: ${code}\n${printed}`)),
		);
	});
	return { server, origin };
}

let browser: Browser;
let page: Page;
/** What the page logged as an error or a warning, Vue's hydration mismatches among them. */
let logged: string[];
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(() => browser?.close());
beforeEach(async () => {
	page = await browser.newPage({ locale: "en-US" });
	logged = [];
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type()))
			logged.push(message.text());
	});
	page.on("pageerror", (error) => logged.push(error.message));
	onTestFinished(() => page.close());
});

const text = (selector: string) => page.locator(selector).textContent();
/** Opens `path` with the locale's cookie, as the language switch leaves it. */
async function openIn(origin: string, locale: string, path = "/") {
	await page
		.context()
		.addCookies([{ name: "lang", value: locale, url: origin }]);
	await page.goto(origin + path);
	await page.locator("#hydrated").waitFor();
}

describe("the Vue example, built", { timeout: 30_000 }, () => {
	let origin = "";
	let app: Served | undefined;
	beforeAll(async () => {
		for (const args of [
			["build", "--outDir", "dist/client"],
			["build", "--ssr", "src/entry-server.ts", "--outDir", "dist/server"],
		]) {
			const build = spawnSync(vite, args, {
				cwd: example,
				env: outsideTests(),
				encoding: "utf8",
			});
			if (build.status !== 0) {
				throw new Error(
					`vite ${args.join(" ")} failed:\n${build.stdout}${build.stderr}`,
				);
			}
		}
		app = await served();
		origin = app.origin;
	}, 180_000);
	afterAll(() => app && stopped(app.server));

	it("typechecks against the package's built declarations, as an app's vue-tsc sees them", () => {
		const checked = spawnSync(vueTsc, ["--noEmit", "--pretty", "false"], {
			cwd: example,
			env: outsideTests(),
			encoding: "utf8",
		});
		expect(checked.stdout + checked.stderr).toBe("");
		expect(checked.status).toBe(0);
	}, 60_000);

	it("renders in the browser's language, writes it to <html lang>, and hydrates in it", async () => {
		const ro = await browser.newPage({ locale: "ro-MD" });
		onTestFinished(() => ro.close());
		await ro.goto(`${origin}/`);

		expect(await ro.getAttribute("html", "lang")).toBe("ro");
		expect(await ro.locator("h1").textContent()).toBe(
			"Un magazin care îți vorbește limba",
		);
		expect(await ro.locator("#hydrated").textContent()).toBe(
			"Desenat în browser",
		);
	});

	it("renders in the cookie's locale, and the page's own plurals and markup in it", async () => {
		await openIn(origin, "ro");

		expect(await text("#greeting")).toBe("Salut, Ana!");
		expect(await text("#cart")).toBe("1 produs în coș");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");
		expect(await page.locator("#terms a").getAttribute("href")).toBe("/terms");
		expect(await text("#terms a")).toBe("condițiile");
		expect(logged).toEqual([]);
	});

	it("loads only the page's locale's copies of the message chunks", async () => {
		const fetched: string[] = [];
		page.on("request", (request) =>
			fetched.push(new URL(request.url()).pathname),
		);
		await openIn(origin, "ro");
		const messageChunks = fetched.filter((path) =>
			/\/grai(-[^/]+)?\//.test(path),
		);

		expect(messageChunks.length).toBeGreaterThan(0);
		expect(messageChunks.filter((path) => !path.includes("/grai-ro/"))).toEqual(
			[],
		);
		expect(logged).toEqual([]);
	});

	it("switches locale with setLocale, which keeps the locale in the cookie and loads the page again", async () => {
		await openIn(origin, "en");

		const loaded = page.waitForEvent("load");
		await page.click("#language");
		await loaded;

		expect(await page.getAttribute("html", "lang")).toBe("ro");
		expect(await text("h1")).toBe("Un magazin care îți vorbește limba");
	});

	it("renders interleaved requests each in its own locale", async () => {
		const locales = Array.from({ length: 24 }, (_, index) =>
			index % 2 === 0 ? "en" : "ro",
		);
		const pages = await Promise.all(
			locales.map((locale) =>
				fetch(`${origin}/`, { headers: { cookie: `lang=${locale}` } }).then(
					(response) => response.text(),
				),
			),
		);
		const titles = {
			en: "A shop that speaks your language",
			ro: "Un magazin care îți vorbește limba",
		};

		expect(
			pages.map((html) =>
				Object.entries(titles)
					.filter(([, title]) => html.includes(title))
					.map(([locale]) => locale),
			),
		).toEqual(locales.map((locale) => [locale]));
	});
});

describe("the Vue example under Vite's dev server", { timeout: 30_000 }, () => {
	let origin = "";
	let app: Served | undefined;
	let first = { release: () => {} };
	beforeAll(async () => {
		// A first start, whose output another writer keeps from being written until the second test.
		first = firstStart(outdir, { held: true });
		app = await served(["--dev"]);
		origin = app.origin;
	}, 60_000);
	afterAll(async () => {
		first.release();
		if (app) await stopped(app.server);
	});

	/** Writes `text` as the Romanian title, and puts the catalog back after the test. */
	function editTitle(text: string): void {
		const file = join(example, "messages/ro.json");
		const catalog = readFileSync(file, "utf8");
		onTestFinished(() => writeFileSync(file, catalog));
		writeFileSync(
			file,
			JSON.stringify({ ...JSON.parse(catalog), title: text }, null, "\t"),
		);
	}

	it("serves the first page before its first compile's output is written, and hydrates without a mismatch", async () => {
		await openIn(origin, "ro");
		await page
			.getByRole("heading", { name: "Un magazin care îți vorbește limba" })
			.waitFor();
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");

		expect(existsSync(join(outdir, ".grai", "lock"))).toBe(true);
		expect(logged).toEqual([]);
	});

	it("renders an edit made while the first compile's output waits to be written", async () => {
		await openIn(origin, "ro");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();

		editTitle("Un magazin pe limba ta");
		first.release();
		await page
			.getByRole("heading", { name: "Un magazin pe limba ta" })
			.waitFor();

		expect(await text("#cart")).toBe("2 produse în coș");
		expect(logged).toEqual([]);
	});

	it("renders an edited message again in place, keeping the page's state, and hydrates without a mismatch", async () => {
		await openIn(origin, "ro");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		await page.evaluate(() => Object.assign(globalThis, { unreloaded: true }));

		editTitle("Un magazin pe limba ta");
		await page
			.getByRole("heading", { name: "Un magazin pe limba ta" })
			.waitFor();

		expect(await page.evaluate(() => "unreloaded" in globalThis)).toBe(true);
		expect(await text("#cart")).toBe("2 produse în coș");
		expect(logged).toEqual([]);
	});
});

describe("the Vue example under Vite's dev server, a first start with an error only the output's write finds", {
	timeout: 30_000,
}, () => {
	let origin = "";
	let app: Served | undefined;
	let restore = () => {};
	beforeAll(async () => {
		restore = conflictingInput(join(example, "messages"));
		firstStart(outdir);
		app = await served(["--dev"]);
		origin = app.origin;
	}, 60_000);
	afterAll(async () => {
		if (app) await stopped(app.server);
		restore();
	});

	it("serves the first page in its locale, then shows the error in Vite's overlay", async () => {
		await openIn(origin, "ro");
		await page
			.getByRole("heading", { name: "Un magazin care îți vorbește limba" })
			.waitFor();
		await page
			.locator("vite-error-overlay")
			.getByText(conflictingInputError)
			.waitFor();
	});
});
