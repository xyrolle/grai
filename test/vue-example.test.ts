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

// The Vue example (examples/vue): built by Vite, checked by vue-tsc against the package's built
// declarations and served by its own server, then under Vite's dev server, its pages in Chromium.
// One file, so that the dev suite's edits never reach a build.
const example = fileURLToPath(new URL("../examples/vue/", import.meta.url));
const vite = join(example, "node_modules/.bin/vite");
const vueTsc = join(example, "node_modules/.bin/vue-tsc");

/** Starts the example's server, `node server.ts` with `args`, until the suite ends. */
function served(port: number, args: string[] = []): void {
	let server: ChildProcess | undefined;
	beforeAll(async () => {
		const started = spawn("node", ["server.ts", ...args], {
			cwd: example,
			env: outsideTests({ PORT: String(port) }),
		});
		server = started;
		await new Promise<void>((resolve, reject) => {
			started.stdout.on("data", (chunk) => {
				if (String(chunk).includes("Listening on")) resolve();
			});
			started.on("exit", (code) =>
				reject(new Error(`the example's server exited: ${code}`)),
			);
		});
	}, 60_000);
	afterAll(() => {
		server?.kill();
	});
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
	const origin = "http://localhost:4820";
	beforeAll(() => {
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
	}, 120_000);
	served(4820);

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
	const origin = "http://localhost:4821";
	served(4821, ["--dev"]);

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
