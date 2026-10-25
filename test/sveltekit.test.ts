import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	onTestFinished,
} from "vitest";

// The SvelteKit example (examples/sveltekit), built as an app builds it, with grai/sveltekit/vite's
// plugin, served by adapter-node, and its pages in a real browser.
const example = fileURLToPath(
	new URL("../examples/sveltekit/", import.meta.url),
);
const bin = (name: string) => join(example, "node_modules/.bin", name);

/** Runs one of the example's build steps, failing with what it printed. */
function run(command: string, args: string[]): void {
	const { status, stdout, stderr } = spawnSync(bin(command), args, {
		cwd: example,
		encoding: "utf8",
	});
	if (status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}${stderr}`);
	}
}

/** Builds the app in Vite's `mode` (`production` by default) and serves it. */
async function served(port: number, mode = "production") {
	run("vite", ["build", "--mode", mode]);
	const server = spawn("node", ["build"], {
		cwd: example,
		env: { ...process.env, PORT: String(port) },
	});
	await new Promise<void>((resolve, reject) => {
		server.stdout.on("data", (chunk) => {
			if (String(chunk).includes("Listening on")) resolve();
		});
		server.on("exit", (code) =>
			reject(new Error(`the server exited: ${code}`)),
		);
	});
	return server;
}

/** Stops a server and waits for it to exit, so the next one finds its port free. */
async function stopped(server: ChildProcess | undefined): Promise<void> {
	if (server === undefined || server.exitCode !== null) return;
	const exited = new Promise((resolve) => server.once("exit", resolve));
	server.kill();
	await exited;
}

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(() => browser?.close());

/** Opens `path` in a new browser context made by `context`. */
async function open(
	origin: string,
	path: string,
	context: Parameters<Browser["newContext"]>[0] = {},
): Promise<Page> {
	const page = await (await browser.newContext(context)).newPage();
	await page.goto(origin + path);
	return page;
}

const html = (page: Page, attribute: "lang" | "dir") =>
	page.locator("html").getAttribute(attribute);

// Building and serving an app takes seconds.
describe("handleLocale, by the URL prefix", { timeout: 30_000 }, () => {
	const origin = "http://localhost:4751";
	let server: ChildProcess;
	beforeAll(async () => {
		server = await served(4751);
	}, 60_000);
	afterAll(() => stopped(server));

	// As an app's checker sees it: the example's code and output against grai's built declarations.
	it("type-checks, under Kit's own checkJs", () => {
		run("svelte-kit", ["sync"]);
		run("svelte-check", [
			"--tsconfig",
			"./tsconfig.json",
			"--tsgo-experimental-api",
			"--fail-on-warnings",
		]);
	});

	it("renders a page in the locale its prefix names, routed without the prefix", async () => {
		const page = await open(origin, "/ro/about");
		expect(await html(page, "lang")).toBe("ro");
		expect(await page.locator("h1").textContent()).toBe("Despre acest exemplu");
		await page.context().close();
	});

	it("renders the base locale without a prefix", async () => {
		const page = await open(origin, "/about");
		expect(await html(page, "lang")).toBe("en");
		expect(await page.locator("h1").textContent()).toBe("About this example");
		await page.context().close();
	});

	it("writes the direction of the locale's script", async () => {
		const page = await open(origin, "/ar/");
		expect(await html(page, "dir")).toBe("rtl");
		expect(await html(page, "lang")).toBe("ar");
		await page.context().close();
	});

	it("hydrates in the locale the server drew the page in", async () => {
		const page = await open(origin, "/ro/");
		await page.getByText("Desenat în browser").waitFor();
		expect(await page.locator("h1").textContent()).toBe("Bună ziua");
		expect(await page.getByRole("link").getAttribute("href")).toBe("/ro/about");
		await page.context().close();
	});

	it("downloads only its locale's copies of the message chunks", async () => {
		const page = await (await browser.newContext()).newPage();
		const messages = messageChunks(page);
		await page.goto(`${origin}/ro/`);
		await page.getByText("Desenat în browser").waitFor();

		expect(messages.length).toBeGreaterThan(0);
		expect(notRomanian(messages)).toEqual([]);
		// Each copy is smaller than the shared chunk it stands for, which holds every locale.
		for (const path of messages) {
			const shared = path.replace("/grai-ro/", "/grai/");
			expect(await bytesOf(origin + path)).toBeLessThan(
				await bytesOf(origin + shared),
			);
		}
		await page.context().close();
	});
});

/** The paths of the message chunks the page downloads, as it downloads them. */
function messageChunks(page: Page): string[] {
	const paths: string[] = [];
	page.on("response", (response) => {
		const { pathname } = new URL(response.url());
		if (pathname.includes("/immutable/chunks/grai")) paths.push(pathname);
	});
	return paths;
}

/** The paths that are not Romanian copies. */
const notRomanian = (paths: string[]) =>
	paths.filter((path) => !path.startsWith("/_app/immutable/chunks/grai-ro/"));

/** The size of the file served at `url`. */
async function bytesOf(url: string): Promise<number> {
	return (await (await fetch(url)).arrayBuffer()).byteLength;
}

describe("handleLocale, in a build without the locale copies", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4753";
	let server: ChildProcess;
	beforeAll(async () => {
		// The same app, built with grai/svelte's plugin, which writes no copies.
		server = await served(4753, "svelte");
	}, 60_000);
	afterAll(() => stopped(server));

	it("writes no import map, and the page loads the shared message chunks", async () => {
		const html = await (await fetch(`${origin}/ro/`)).text();
		expect(html).not.toContain("importmap");

		const page = await (await browser.newContext()).newPage();
		const messages = messageChunks(page);
		const failed: string[] = [];
		page.on("response", (response) => {
			if (response.status() >= 400) failed.push(response.url());
		});
		await page.goto(`${origin}/ro/`);
		await page.getByText("Desenat în browser").waitFor();

		expect(failed).toEqual([]);
		expect(messages.length).toBeGreaterThan(0);
		expect(
			messages.filter(
				(path) => !path.startsWith("/_app/immutable/chunks/grai/"),
			),
		).toEqual([]);
		await page.context().close();
	});
});

describe("handleLocale, by the cookie and Accept-Language", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4752";
	let server: ChildProcess;
	beforeAll(async () => {
		// The same app, with another strategy, the cookie, else the browser's languages, and a CSP
		// whose scripts need Kit's nonce.
		server = await served(4752, "cookie");
	}, 60_000);
	afterAll(() => stopped(server));

	it("renders in the cookie's locale", async () => {
		const page = await (await browser.newContext()).newPage();
		await page
			.context()
			.addCookies([{ name: "lang", value: "ro", url: origin }]);
		await page.goto(`${origin}/`);
		expect(await html(page, "lang")).toBe("ro");
		await page.getByText("Desenat în browser").waitFor();
		await page.context().close();
	});

	it("downloads only its locale's copies under a CSP whose scripts need a nonce", async () => {
		const page = await (await browser.newContext()).newPage();
		await page
			.context()
			.addCookies([{ name: "lang", value: "ro", url: origin }]);
		const messages = messageChunks(page);
		await page.goto(`${origin}/`);
		await page.getByText("Desenat în browser").waitFor();

		expect(messages.length).toBeGreaterThan(0);
		expect(notRomanian(messages)).toEqual([]);
		await page.context().close();
	});

	it("renders in the browser's language when no cookie names one", async () => {
		const page = await open(origin, "/", { locale: "ar-EG" });
		expect(await html(page, "lang")).toBe("ar");
		expect(await page.locator("h1").textContent()).toBe("مرحبا");
		await page.context().close();
	});
});

describe("grai/sveltekit/client under vite dev", { timeout: 30_000 }, () => {
	const origin = "http://localhost:4750";
	let server: ChildProcess;
	beforeAll(async () => {
		const started = spawn(
			bin("vite"),
			["dev", "--port", "4750", "--strictPort"],
			{
				cwd: example,
			},
		);
		server = started;
		await new Promise<void>((resolve, reject) => {
			started.stdout.on("data", (chunk) => {
				if (String(chunk).includes("localhost:4750")) resolve();
			});
			started.on("exit", (code) =>
				reject(new Error(`vite dev exited: ${code}`)),
			);
		});
	}, 60_000);
	afterAll(() => stopped(server));

	/** Gives a Romanian message new text, as an editor saves it, and puts the catalog back after. */
	function edit(key: string, text: string): void {
		const file = join(example, "messages/ro.json");
		const catalog = readFileSync(file, "utf8");
		onTestFinished(() => writeFileSync(file, catalog));
		writeFileSync(
			file,
			`${JSON.stringify({ ...JSON.parse(catalog), [key]: text }, null, "\t")}\n`,
		);
	}

	/**
	 * Waits until the page has started, which a server-rendered heading does not show: an edit
	 * whose loads Kit runs again before its client has started is lost. Then marks the page, so a
	 * reload, which would lose the mark, shows.
	 */
	const mark = async (page: Page) => {
		await page.waitForLoadState("networkidle");
		await page.evaluate("window.unreloaded = true");
	};
	const marked = (page: Page) => page.evaluate("window.unreloaded");

	it("draws an edited message again in place, without a reload", async () => {
		const page = await open(origin, "/ro/");
		await page.getByText("Desenat în browser").waitFor();
		await mark(page);

		edit("greeting", "Salut");
		await page.getByRole("heading", { name: "Salut" }).waitFor();

		expect(await marked(page)).toBe(true);
		await page.context().close();
	});

	it("draws again the text a server load returns", async () => {
		const page = await open(origin, "/ro/about");
		await page.getByRole("heading", { name: "Despre acest exemplu" }).waitFor();
		await mark(page);

		edit("about_title", "Despre exemplu");
		await page.getByRole("heading", { name: "Despre exemplu" }).waitFor();

		expect(await marked(page)).toBe(true);
		await page.context().close();
	});
});
