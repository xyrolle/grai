import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// The Astro example (examples/astro), built by `astro build` as an app builds it: as a static site
// served by `astro preview`, and rendered on demand by the Node adapter. Its pages in Chromium.
const example = fileURLToPath(new URL("../examples/astro/", import.meta.url));
const astro = join(example, "node_modules/.bin/astro");

/** Runs `astro build`, failing with what it printed. */
function built(args: string[]): void {
	const { status, stdout, stderr } = spawnSync(astro, ["build", ...args], {
		cwd: example,
		encoding: "utf8",
	});
	if (status !== 0) {
		throw new Error(
			`astro build ${args.join(" ")} failed:\n${stdout}${stderr}`,
		);
	}
}

/** Starts a server, resolving once it prints a line that says it is listening. */
async function listening(
	command: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<ChildProcess> {
	const server = spawn(command, args, {
		cwd: example,
		env: { ...process.env, ...env },
	});
	let printed = "";
	await new Promise<void>((resolve, reject) => {
		server.stdout.on("data", (chunk) => {
			printed += chunk;
			if (/localhost:\d+/.test(printed)) resolve();
		});
		server.on("exit", (code) =>
			reject(new Error(`the server exited: ${code}\n${printed}`)),
		);
	});
	return server;
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

/** The tests every build of the example passes, at its origin. */
function aSite(origin: string) {
	it("renders each locale's pages in that locale, with its text direction", async () => {
		await page.goto(`${origin}/ro/about/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ro", "ltr"]);
		expect(await text("h1")).toBe("Despre acest exemplu");

		await page.goto(`${origin}/ar/`);
		expect([await html("lang"), await html("dir")]).toEqual(["ar", "rtl"]);
		expect(await text("h1")).toBe("مرحبا");

		await page.goto(`${origin}/about/`);
		expect([await html("lang"), await html("dir")]).toEqual(["en", "ltr"]);
		expect(await text("h1")).toBe("About this example");
	});

	it("hydrates the Svelte and React islands in the page's locale", async () => {
		await page.goto(`${origin}/ro/`);
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
		await page.goto(`${origin}/ar/`);
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
		await page.goto(`${origin}/ro/about/`);

		expect(await page.locator("#home").getAttribute("href")).toBe("/ro/");
		const languages = await page.locator("#languages a").all();
		expect(
			await Promise.all(languages.map((link) => link.getAttribute("href"))),
		).toEqual(["/about/", "/ro/about/", "/ar/about/"]);
	});
}

// Building the example takes seconds.
describe("the Astro example, prerendered", { timeout: 30_000 }, () => {
	let server: ChildProcess | undefined;
	beforeAll(async () => {
		built([]);
		// --ignore-lock: a one-off server in the foreground, which the suite stops. Astro starts its
		// preview server in the background, out of the suite's reach, when an agent runs the suite.
		server = await listening(astro, [
			"preview",
			"--port",
			"4826",
			"--ignore-lock",
		]);
	}, 120_000);
	afterAll(() => server?.kill());

	aSite("http://localhost:4826");

	it("type-checks with astro check, the types grai compiled for it included", () => {
		const { status, stdout, stderr } = spawnSync(astro, ["check"], {
			cwd: example,
			encoding: "utf8",
		});

		expect(status, `${stdout}${stderr}`).toBe(0);
	}, 60_000);
});

describe("the Astro example, rendered on demand by the Node adapter", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4827";
	let server: ChildProcess | undefined;
	beforeAll(async () => {
		built(["--config", "astro.server.config.ts"]);
		server = await listening(
			process.execPath,
			["dist-server/server/entry.mjs"],
			{ PORT: "4827", HOST: "localhost" },
		);
	}, 120_000);
	afterAll(() => server?.kill());

	aSite(origin);

	it("renders interleaved requests each in its own locale", async () => {
		const titles: [path: string, title: string][] = [
			["/about/", "About this example"],
			["/ro/about/", "Despre acest exemplu"],
			["/ar/about/", "حول هذا المثال"],
		];
		const requests = Array.from({ length: 8 }, () => titles).flat();
		const pages = await Promise.all(
			requests.map(([path]) =>
				fetch(origin + path).then((page) => page.text()),
			),
		);

		expect(
			pages.map((html) =>
				titles.flatMap(([, title]) => (html.includes(title) ? [title] : [])),
			),
		).toEqual(requests.map(([, title]) => [title]));
	});
});
