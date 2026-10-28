import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	conflictingInput,
	conflictingInputError,
	firstStart,
} from "./first-start.ts";
import { stopped } from "./stopped.ts";

// The Astro example (examples/astro), built by `astro build` as an app builds it: as a static site
// served by `astro preview`, and rendered on demand by the Node adapter. Its pages in Chromium.
const example = fileURLToPath(new URL("../examples/astro/", import.meta.url));
const astro = join(example, "node_modules/.bin/astro");
const outdir = join(example, "src/lib/i18n");

/** Runs `astro build`, failing with what it printed, else giving it. */
function built(args: string[]): string {
	const { status, stdout, stderr } = spawnSync(astro, ["build", ...args], {
		cwd: example,
		encoding: "utf8",
	});
	if (status !== 0) {
		throw new Error(
			`astro build ${args.join(" ")} failed:\n${stdout}${stderr}`,
		);
	}
	return `${stdout}${stderr}`;
}

/**
 * Builds the example as `astro build` does, and gives the paths of the pages Astro tells its
 * integrations it built, as a sitemap reads them, and what the build printed.
 */
function builtPages(): { pages: string[]; printed: string } {
	const { status, stdout, stderr } = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("astro-build-pages.js", import.meta.url))],
		{ cwd: example, encoding: "utf8" },
	);
	if (status !== 0) throw new Error(`the build failed:\n${stdout}${stderr}`);
	return {
		pages: JSON.parse(stdout.trim().split("\n").at(-1) ?? "[]"),
		printed: `${stdout}${stderr}`,
	};
}

/**
 * The page at a path: its status, its <html> start tag and its heading, without the attributes
 * `astro dev` gives an element to name its source.
 */
async function pageAt(origin: string, path: string): Promise<string[]> {
	const response = await fetch(origin + encodeURI(path));
	const html = await response.text();
	const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
	return [
		String(response.status),
		...(html.match(/<html[^>]*>/) ?? []),
		...(heading === undefined ? [] : [`<h1>${heading}</h1>`]),
	];
}

/** A server the suite started, and the origin it printed. */
type Served = { server: ChildProcess; origin: string };

/**
 * Starts a server on 127.0.0.1 alone, as localhost can be ::1 beside another process's server, and
 * on a port the system picks, so that runs of this file side by side never meet. It resolves once
 * the server prints the address it listens on. The server leads a process group of its own, so
 * that stopping it stops what it forks.
 */
async function listening(
	command: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<Served> {
	const server = spawn(command, args, {
		cwd: example,
		env: { ...process.env, NO_COLOR: "1", ...env },
		detached: true,
	});
	let printed = "";
	const origin = await new Promise<string>((resolve, reject) => {
		server.stdout?.on("data", (chunk) => {
			printed += chunk;
			const address = /http:\/\/127\.0\.0\.1:\d+/.exec(printed)?.[0];
			if (address !== undefined) resolve(address);
		});
		server.on("exit", (code) =>
			reject(new Error(`the server exited: ${code}\n${printed}`)),
		);
	});
	return { server, origin };
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
const html = (attribute: "lang" | "dir") =>
	page.locator("html").getAttribute(attribute);

/** Every script the page downloads, by its path, with its text. */
function scripts(): Map<string, Promise<string>> {
	const loaded = new Map<string, Promise<string>>();
	page.on("response", (response) => {
		if (response.request().resourceType() === "script") {
			loaded.set(new URL(response.url()).pathname, response.text());
		}
	});
	return loaded;
}

/** The tests every build of the example passes, at the origin it is served at. */
function aSite(site: { origin: string }) {
	it("renders each locale's pages in that locale, with its text direction", async () => {
		await page.goto(`${site.origin}/ro/about/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ro", "ltr"]);
		expect(await text("h1")).toBe("Despre acest exemplu");

		await page.goto(`${site.origin}/ar/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ar", "rtl"]);
		expect(await text("h1")).toBe("مرحبا");

		await page.goto(`${site.origin}/about/`);
		expect([await html("lang"), await html("dir")]).toEqual(["en", "ltr"]);
		expect(await text("h1")).toBe("About this example");
	});

	it("hydrates the Svelte and React islands in the page's locale", async () => {
		await page.goto(`${site.origin}/ro/`);
		await page.locator("#svelte").waitFor();
		await page.locator("#react").waitFor();

		expect(await text("#cart")).toBe("1 produs în coș");
		await page.getByRole("button", { name: "Adaugă un produs" }).click();
		expect(await text("#cart")).toBe("2 produse în coș");
		expect(await text("#welcome")).toBe("Bine ai venit, Ana!");
		expect(await text("#react")).toBe("Desenat de React în browser");
		expect(errors).toEqual([]);
	});

	it("downloads only the page's locale's message chunks", async () => {
		const loaded = scripts();
		await page.goto(`${site.origin}/ar/`);
		await page.locator("#svelte").waitFor();
		await page.locator("#react").waitFor();
		const paths = [...loaded.keys()];
		const code = (await Promise.all(loaded.values())).join("\n");

		expect(paths.some((path) => path.startsWith("/_astro/grai-ar/"))).toBe(
			true,
		);
		expect(
			paths.filter((path) => /^\/_astro\/grai(-en|-ro)?\//.test(path)),
		).toEqual([]);
		for (const words of ["Add an item", "Adaugă un produs", "Drawn by React"])
			expect(code).not.toContain(words);
		expect(code).toContain("أضف منتجا");
	});

	it("links to each locale's page through Astro's i18n routing", async () => {
		await page.goto(`${site.origin}/ro/about/`);

		expect(await page.locator("#home").getAttribute("href")).toBe("/ro/");
		const languages = await page.locator("#languages a").all();
		expect(
			await Promise.all(languages.map((link) => link.getAttribute("href"))),
		).toEqual(["/about/", "/ro/about/", "/ar/about/"]);
	});
}

// Building the example takes seconds.
describe("the Astro example, prerendered", { timeout: 30_000 }, () => {
	const site = { origin: "" };
	let served: Served | undefined;
	let pages: string[] = [];
	let printed = "";
	beforeAll(async () => {
		({ pages, printed } = builtPages());
		// --ignore-lock: a one-off server in the foreground, which the suite stops. Astro starts its
		// preview server in the background, out of the suite's reach, when an agent runs the suite.
		served = await listening(astro, [
			"preview",
			"--port",
			"0",
			"--host",
			"127.0.0.1",
			"--ignore-lock",
		]);
		site.origin = served.origin;
	}, 120_000);
	afterAll(() => served && stopped(served.server));

	aSite(site);

	it("writes each page at its paths in its locale's words, which pathnames give", async () => {
		expect(await pageAt(site.origin, "/ro/despre/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Despre acest exemplu</h1>",
		]);
		expect(await pageAt(site.origin, "/ar/حول/")).toEqual([
			"200",
			'<html lang="ar" dir="rtl">',
			"<h1>حول هذا المثال</h1>",
		]);
		expect(await pageAt(site.origin, "/ro/produse/2/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Produsul 2</h1>",
		]);
		expect(await pageAt(site.origin, "/ro/about/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Despre acest exemplu</h1>",
		]);
	});

	it("tells integrations of each page at its words, as a sitemap reads the pages", () => {
		expect(pages.toSorted()).toEqual(
			[
				"",
				"about/",
				"ar/",
				"ar/about/",
				"ar/products/1/",
				"ar/products/2/",
				"ar/حول/",
				"products/1/",
				"products/2/",
				"ro/",
				"ro/about/",
				"ro/despre/",
				"ro/products/1/",
				"ro/products/2/",
				"ro/produse/1/",
				"ro/produse/2/",
			].toSorted(),
		);
	});

	it("reads no CSP in a site without one, which Astro would warn of on every page", () => {
		expect(printed).toContain("page(s) built");
		expect(printed).not.toContain("CSP was not configured");
	});

	it("type-checks with astro check, the types grai compiled for it included", () => {
		const { status, stdout, stderr } = spawnSync(astro, ["check"], {
			cwd: example,
			encoding: "utf8",
		});

		expect(status, `${stdout}${stderr}`).toBe(0);
	}, 60_000);
});

describe("the Astro example, prerendered under a CSP", {
	timeout: 30_000,
}, () => {
	beforeAll(() => {
		built(["--config", "astro.csp.config.ts"]);
	}, 120_000);

	it("lets each page's import map through its CSP by the map's hash", () => {
		for (const page of ["index.html", "ro/index.html", "ar/about/index.html"]) {
			const html = readFileSync(join(example, "dist-csp", page), "utf8");
			const map = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1];
			const policy =
				/<meta http-equiv="content-security-policy" content="([^"]*)"/.exec(
					html,
				)?.[1];
			const hash = createHash("sha256")
				.update(map ?? "")
				.digest("base64");

			expect(map, page).toBeDefined();
			expect(policy, page).toContain(`'sha256-${hash}'`);
		}
	});
});

describe("the Astro example, under a base path", { timeout: 30_000 }, () => {
	let origin = "";
	let served: Served | undefined;
	beforeAll(async () => {
		built(["--config", "astro.base.config.ts"]);
		served = await listening(process.execPath, ["dist-base/server/entry.mjs"], {
			PORT: "0",
			HOST: "127.0.0.1",
		});
		origin = served.origin;
	}, 120_000);
	afterAll(() => served && stopped(served.server));

	it("renders each locale's pages in the locale named after the base path", async () => {
		await page.goto(`${origin}/shop/ro/about/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ro", "ltr"]);
		expect(await text("h1")).toBe("Despre acest exemplu");

		await page.goto(`${origin}/shop/ar/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ar", "rtl"]);
	});
});

describe("the Astro example, rendered on demand by the Node adapter", {
	timeout: 30_000,
}, () => {
	const site = { origin: "" };
	let served: Served | undefined;
	beforeAll(async () => {
		built(["--config", "astro.server.config.ts"]);
		served = await listening(
			process.execPath,
			["dist-server/server/entry.mjs"],
			{ PORT: "0", HOST: "127.0.0.1" },
		);
		site.origin = served.origin;
	}, 120_000);
	afterAll(() => served && stopped(served.server));

	aSite(site);

	it("serves a page at its words, on demand, and from the file a prerendered page's words have", async () => {
		// Astro's server skips grai's prerendered routes for a path no file was written at, and
		// renders it on demand, as grai's middleware routes it.
		expect(await pageAt(site.origin, "/ro/despre/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Despre acest exemplu</h1>",
		]);
		expect(existsSync(join(example, "dist-server/client/ro/despre"))).toBe(
			false,
		);
		expect(await pageAt(site.origin, "/ro/produse/1/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Produsul 1</h1>",
		]);
		expect(
			existsSync(join(example, "dist-server/client/ro/produse/1/index.html")),
		).toBe(true);
	});

	it("renders interleaved requests each in its own locale", async () => {
		const titles: [path: string, title: string][] = [
			["/about/", "About this example"],
			["/ro/about/", "Despre acest exemplu"],
			["/ar/about/", "حول هذا المثال"],
		];
		const requests = Array.from({ length: 8 }, () => titles).flat();
		const pages = await Promise.all(
			requests.map(([path]) =>
				fetch(site.origin + path).then((page) => page.text()),
			),
		);

		expect(
			pages.map((html) =>
				titles.flatMap(([, title]) => (html.includes(title) ? [title] : [])),
			),
		).toEqual(requests.map(([, title]) => [title]));
	});
});

/**
 * Starts `astro dev`. --ignore-lock: in the foreground, as `astro preview` above. Astro's dev
 * server leaves requests to Vite's alone inside Vitest, by the VITEST that the suite's runner sets.
 * No update check: in a project without a recent one, as a fresh clone is, the server asks the
 * registry and writes .astro/settings.json once it listens. Astro skips one change of that file,
 * but macOS can report the write as two, and the second restarts the server under the test's
 * request.
 */
const dev = () =>
	listening(
		astro,
		["dev", "--port", "0", "--host", "127.0.0.1", "--ignore-lock"],
		{ VITEST: "", ASTRO_DISABLE_UPDATE_CHECK: "true" },
	);

describe("the Astro example in dev", { timeout: 30_000 }, () => {
	let origin = "";
	let served: Served | undefined;
	let first = { release: () => {} };
	const catalog = join(example, "messages/ro.json");
	const words = readFileSync(catalog, "utf8");
	beforeAll(async () => {
		// A first start, whose output another writer keeps from being written until the second test.
		first = firstStart(outdir, { held: true });
		served = await dev();
		origin = served.origin;
	}, 60_000);
	afterAll(async () => {
		first.release();
		if (served) await stopped(served.server);
		writeFileSync(catalog, words);
	});

	it("matches a path in its locale's words to grai's route, and renders the page's route there", async () => {
		expect(await pageAt(origin, "/ro/despre/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Despre acest exemplu</h1>",
		]);
		expect(await pageAt(origin, "/ro/produse/2/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Produsul 2</h1>",
		]);
		expect(await pageAt(origin, "/ro/about/")).toEqual([
			"200",
			'<html lang="ro" dir="ltr">',
			"<h1>Despre acest exemplu</h1>",
		]);
		expect((await pageAt(origin, "/en/despre/"))[0]).toBe("404");
		// Rendered before the first compile's output could be written.
		expect(existsSync(join(outdir, ".grai", "lock"))).toBe(true);
	});

	it("renders an edit made while the first compile's output waits to be written", async () => {
		writeFileSync(
			catalog,
			words.replace('"Despre acest exemplu"', '"Despre exemplu"'),
		);
		first.release();

		await expect
			.poll(() => pageAt(origin, "/ro/despre/"), { timeout: 20_000 })
			.toEqual([
				"200",
				'<html lang="ro" dir="ltr">',
				"<h1>Despre exemplu</h1>",
			]);
	});
});

describe("the Astro example in dev, a first start with an error only the output's write finds", {
	timeout: 30_000,
}, () => {
	let origin = "";
	let served: Served | undefined;
	let restore = () => {};
	beforeAll(async () => {
		restore = conflictingInput(join(example, "messages"));
		firstStart(outdir);
		served = await dev();
		origin = served.origin;
	}, 60_000);
	afterAll(async () => {
		if (served) await stopped(served.server);
		restore();
	});

	it("renders the first page in its locale, then shows the error in Vite's overlay", async () => {
		await page.goto(`${origin}/ro/despre/`);
		expect(await text("h1")).toBe("Despre acest exemplu");
		await page
			.locator("vite-error-overlay")
			.getByText(conflictingInputError)
			.waitFor();
	});
});
