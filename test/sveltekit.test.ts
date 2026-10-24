import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The SvelteKit example (examples/sveltekit), compiled and built as an app builds it, served by
// adapter-node, and its pages in a real browser.
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

/** Compiles the catalogs by `config` (grai.config.json by default), builds the app and serves it. */
async function served(port: number, config?: string) {
	run(
		"grai",
		config === undefined ? ["compile"] : ["compile", "--config", config],
	);
	run("vite", ["build"]);
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
	afterAll(() => server?.kill());

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
});

describe("handleLocale, by the cookie and Accept-Language", {
	timeout: 30_000,
}, () => {
	const origin = "http://localhost:4752";
	let server: ChildProcess;
	let configDir: string;
	beforeAll(async () => {
		// The same app, with another strategy: the cookie, else the browser's languages.
		configDir = mkdtempSync(join(tmpdir(), "grai-sveltekit-"));
		const config = join(configDir, "grai.config.json");
		writeFileSync(
			config,
			JSON.stringify({
				locales: ["en", "ro", "ar"],
				baseLocale: "en",
				catalogs: join(example, "messages/{locale}.json"),
				outdir: join(example, "src/lib/i18n"),
				strategy: ["cookie", "preferredLanguage"],
				cookieName: "lang",
			}),
		);
		server = await served(4752, config);
	}, 60_000);
	afterAll(() => {
		server?.kill();
		rmSync(configDir, { recursive: true, force: true });
	});

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

	it("renders in the browser's language when no cookie names one", async () => {
		const page = await open(origin, "/", { locale: "ar-EG" });
		expect(await html(page, "lang")).toBe("ar");
		expect(await page.locator("h1").textContent()).toBe("مرحبا");
		await page.context().close();
	});
});
