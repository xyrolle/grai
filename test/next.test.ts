import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	PHASE_PRODUCTION_BUILD,
	PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { getRewrittenUrl } from "next/experimental/testing/server.js";
import { NextRequest, NextResponse } from "next/server.js";
import { type Browser, chromium, type Page } from "playwright-core";
import { build } from "vite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
} from "vitest";
import { withGrai } from "../src/next/config.ts";
import { project } from "./project.ts";
import { stopped } from "./stopped.ts";

/** Runs from a project's directory, as `next` does, until the test ends. */
function inProject(dir: string): void {
	const before = process.cwd();
	process.chdir(dir);
	onTestFinished(() => process.chdir(before));
}

describe("withGrai", () => {
	it("compiles the catalogs for a build, and resolves the output's name to the outdir beside the app's own names", async () => {
		const { dir } = project({ en: { title: "Your cart" } });
		inProject(dir);

		const config = await withGrai({
			turbopack: { resolveAlias: { "@app": "./app" } },
		})(PHASE_PRODUCTION_BUILD);

		expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
		expect(config.turbopack?.resolveAlias).toEqual({
			"@app": "./app",
			"grai/next/output/*": "./out/*",
		});
	});

	it("fails a build whose catalogs do not compile, after printing each error", async () => {
		const { dir } = project({ en: { title: "Your cart" }, de: {} });
		inProject(dir);
		const printed = vi.spyOn(console, "error").mockImplementation(() => {});
		onTestFinished(() => printed.mockRestore());

		await expect(withGrai()(PHASE_PRODUCTION_BUILD)).rejects.toThrow(
			"grai: the catalogs did not compile, with 1 error.",
		);
		expect(printed.mock.calls).toEqual([
			[
				'messages/de.json: the catalog has no messages, so de would render nothing. Add its messages, or remove de from "locales".',
			],
			["grai: 1 error"],
		]);
	});

	it("gives a command that bundles nothing, such as next start, the config as it is, without reading grai's", async () => {
		const { dir } = project({ en: { title: "Your cart" } });
		inProject(join(dir, "messages"));
		const nextConfig = { poweredByHeader: false };

		expect(await withGrai(nextConfig)(PHASE_PRODUCTION_SERVER)).toBe(
			nextConfig,
		);
	});
});

/**
 * grai/next's proxy for a project's output, bundled as Next bundles it: its imports of the
 * output resolved to the project's outdir, and Next's own modules left to Node.
 */
async function proxyFor(dir: string) {
	const outDir = join(dir, "proxy");
	await build({
		configFile: false,
		logLevel: "silent",
		resolve: {
			alias: [
				{
					find: /^grai\/next\/output\/(.*)$/,
					replacement: join(dir, "out", "$1"),
				},
			],
		},
		build: {
			outDir,
			minify: false,
			lib: {
				entry: fileURLToPath(new URL("../src/next/proxy.ts", import.meta.url)),
				formats: ["es"],
				fileName: "proxy",
			},
			rolldownOptions: { external: [/^next\//, /^node:/] },
		},
	});
	const proxy: (request: NextRequest) => Promise<Response> = (
		await import(pathToFileURL(join(outDir, "proxy.js")).href)
	).proxy;
	return (path: string, headers: Record<string, string> = {}) =>
		proxy(new NextRequest(`https://shop.test${path}`, { headers }));
}

/** The path a proxy's response rewrites the request to. */
function rewrittenPath(response: Response): string | undefined {
	if (!(response instanceof NextResponse)) {
		throw new Error(
			"The proxy answered with a response of its own, not Next's.",
		);
	}
	return getRewrittenUrl(response)?.replace("https://shop.test", "");
}

describe("the proxy", () => {
	const catalogs = { en: { title: "Your cart" }, ro: { title: "Coșul tău" } };

	it("rewrites a request under its locale's segment, the URL's prefix stripped, the base locale's absent", async () => {
		const { dir, load } = project(catalogs, { strategy: ["url"] });
		await load();
		const proxied = await proxyFor(dir);
		const rewritten = async (path: string) =>
			rewrittenPath(await proxied(path));

		expect(await rewritten("/")).toBe("/en");
		expect(await rewritten("/cart?step=2")).toBe("/en/cart?step=2");
		expect(await rewritten("/ro/cart")).toBe("/ro/cart");
		expect(await rewritten("/en/cart")).toBe("/en/en/cart");
	});

	it("rewrites by the cookie, then Accept-Language, leaves the path as it is, and varies by both", async () => {
		const { dir, load } = project(catalogs, {
			strategy: ["cookie", "preferredLanguage"],
			cookieName: "lang",
		});
		await load();
		const proxied = await proxyFor(dir);
		const rewritten = async (path: string, headers: Record<string, string>) =>
			rewrittenPath(await proxied(path, headers));

		expect(await rewritten("/cart", { cookie: "lang=ro" })).toBe("/ro/cart");
		expect(
			await rewritten("/cart", { "accept-language": "ro-MD, en;q=0.5" }),
		).toBe("/ro/cart");
		expect(await rewritten("/ro/cart", { cookie: "lang=en" })).toBe(
			"/en/ro/cart",
		);
		expect(await rewritten("/cart", {})).toBe("/en/cart");
		expect((await proxied("/cart")).headers.get("vary")).toBe(
			"Cookie, Accept-Language",
		);
	});
});

// The Next example (examples/next), built by `next build` as an app builds it, served by
// `next start`, and its pages in Chromium: under Turbopack, Next's default, and under webpack.
const example = fileURLToPath(new URL("../examples/next/", import.meta.url));
const next = join(example, "node_modules/.bin/next");
/** Next's environment: no telemetry, which would phone home and outlive the test in a process of its own. */
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };

/**
 * Builds the example with the given bundler flags and serves it until the suite ends, on a port the
 * system picks, so that runs of this file side by side never meet. The origin is set once it serves.
 */
function servedWith(flags: string[]): { origin: string } {
	const served = { origin: "" };
	let server: ChildProcess | undefined;
	beforeAll(async () => {
		const build = spawnSync(next, ["build", ...flags], {
			cwd: example,
			env,
			encoding: "utf8",
		});
		if (build.status !== 0) {
			throw new Error(`next build failed:\n${build.stdout}${build.stderr}`);
		}
		// The leader of a process group of its own, so that stopping it stops what it forks.
		server = spawn(next, ["start", "--port", "0"], {
			cwd: example,
			env,
			detached: true,
		});
		served.origin = await servedAt(server);
	}, 120_000);
	afterAll(() => (server ? stopped(server) : undefined));
	return served;
}

/** The URL `next start` prints as it listens, once it has also printed that it is ready. */
function servedAt(server: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		server.stdout?.on("data", (chunk) => {
			output += chunk;
			const url = /- Local:\s+(http:\/\/\S+)/.exec(output)?.[1];
			if (url !== undefined && output.includes("Ready")) resolve(url);
		});
		server.on("exit", (code) =>
			reject(new Error(`next start exited: ${code}\n${output}`)),
		);
	});
}

let browser: Browser;
let page: Page;
/** What the page logged as an error, a hydration mismatch among them. */
let errors: string[];
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(() => browser?.close());
beforeEach(async () => {
	page = await browser.newPage();
	errors = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
});

const text = (selector: string) => page.locator(selector).textContent();
/** Marks the document, so a test tells a navigation in place from a page load. */
const mark = () =>
	page.evaluate(() => Object.assign(globalThis, { marked: true }));
const marked = () => page.evaluate(() => "marked" in globalThis);

describe("the Next example, built with Turbopack", () => {
	const served = servedWith([]);

	it("renders the base locale unprefixed, in server and client components, and hydrates without an error", async () => {
		await page.goto(`${served.origin}/`);

		expect(await page.getAttribute("html", "lang")).toBe("en");
		expect(await text("h1")).toBe("A shop that speaks your language");
		expect(await text("#greeting")).toBe("Hello, Ana!");
		expect(await text("#cart")).toBe("1 item in your cart");
		expect(await text("#terms a")).toBe("terms");
		await page.getByRole("button", { name: "Add an item" }).click();
		expect(await text("#cart")).toBe("2 items in your cart");
		expect(errors).toEqual([]);
	});

	it("renders a prefixed locale, with its own plural categories in a client component", async () => {
		await page.goto(`${served.origin}/ro`);

		expect(await page.getAttribute("html", "lang")).toBe("ro");
		expect(await text("h1")).toBe("Un magazin care îți vorbește limba");
		expect(await text("#cart")).toBe("1 produs în coș");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");
		expect(await text("#terms a")).toBe("condițiile");
		expect(errors).toEqual([]);
	});

	it("renders interleaved requests each in its own locale, in server and client components", async () => {
		const expected = {
			"/delivery": [
				"When your order arrives",
				"It arrives in 3 days.",
				"1 item in your cart",
			],
			"/ro/delivery": [
				"Când sosește comanda",
				"Sosește în 3 zile.",
				"1 produs în coș",
			],
		};
		const paths = Array.from({ length: 24 }, (_, index) =>
			index % 2 === 0 ? "/delivery" : "/ro/delivery",
		);
		const pages = await Promise.all(
			paths.map((path) =>
				fetch(served.origin + path).then((page) => page.text()),
			),
		);

		const every = Object.values(expected).flat();
		expect(
			pages.map((html) => every.filter((words) => html.includes(words))),
		).toEqual(paths.map((path) => expected[path]));
	});

	it("navigates in place within a locale, and the page and its metadata bind the locale themselves", async () => {
		await page.goto(`${served.origin}/ro`);
		await mark();

		await page.click("#about");
		await page.waitForURL(`${served.origin}/ro/about`);

		expect(await text("h1")).toBe("Despre magazin");
		expect(await page.title()).toBe("Despre magazin");
		expect(await marked()).toBe(true);
		expect(errors).toEqual([]);
	});

	it("loads the page anew when a link leads into another locale", async () => {
		await page.goto(`${served.origin}/about`);
		await mark();

		const loaded = page.waitForEvent("load");
		await page.click("#translation");
		await loaded;

		expect(page.url()).toBe(`${served.origin}/ro/about`);
		expect(await text("h1")).toBe("Despre magazin");
		expect(await marked()).toBe(false);
	});

	it("switches locale with setLocale, which goes to the page's URL in that locale", async () => {
		await page.goto(`${served.origin}/ro`);

		await page.click("#language");
		await page.waitForURL(`${served.origin}/`);

		expect(await text("h1")).toBe("A shop that speaks your language");
		expect(await text("#cart")).toBe("1 item in your cart");
	});
});

describe("the Next example, built with webpack", () => {
	const served = servedWith(["--webpack"]);

	it("renders a prefixed locale in server and client components, hydrates, and navigates in place", async () => {
		await page.goto(`${served.origin}/ro`);
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");
		await mark();
		await page.click("#about");
		await page.waitForURL(`${served.origin}/ro/about`);

		expect(await text("h1")).toBe("Despre magazin");
		expect(await marked()).toBe(true);
		expect(errors).toEqual([]);
	});
});
