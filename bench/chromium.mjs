// A bench page in Chromium, opened as a reader in a locale opens it: with the app's cookie set and
// at the URL of the locale, its document served there and the files of its build beside it, as a
// server serves them. Every script the page loads is kept with its size, compressed on its own as
// a server sends it. An error in the page, a warning or an error in its console, or a request for
// a file the build does not have fails the load.
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { localePath } from "./request.mjs";

/** How long a page may take to set `window.bench`: a page of timed loops takes seconds. */
const PATIENCE = 120_000;

const types = {
	".html": "text/html",
	".js": "text/javascript",
	".json": "application/json",
};

/** Code's bytes, raw and compressed by brotli on their own. */
const sizeOf = (bytes) => ({
	raw: Buffer.byteLength(bytes),
	brotli: brotliCompressSync(bytes).length,
});

/** A built file's bytes, read once a run. */
const sized = new Map();
function fileSize(file) {
	if (!sized.has(file)) sized.set(file, sizeOf(readFileSync(file)));
	return sized.get(file);
}

/**
 * Loads `html` as the app's page in `locale`, the files of `directory`, a build's, at the site's
 * root, the CPU slowed down `rate` times. Returns what the page sets as `window.bench` once it
 * does, and its scripts: those it loaded, in the order it asked for them, then `inline`, the code
 * of those its build wrote into its html, each with its path and bytes.
 */
export async function benchPage(
	browser,
	app,
	locale,
	{ html, directory, inline = [] },
	rate = 1,
) {
	const context = await browser.newContext();
	/** The page's first fault, which ends the wait for its result. */
	const fault = Promise.withResolvers();
	const fail = (text) => fault.resolve(text);
	const scripts = [];
	try {
		await context.addCookies([
			{
				name: app.compilerOptions.cookieName,
				value: locale,
				url: "https://bench.test/",
			},
		]);
		const page = await context.newPage();
		page.on("pageerror", (error) => fail(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error" || message.type() === "warning")
				fail(`${message.type()}: ${message.text()}`);
		});
		const cdp = await context.newCDPSession(page);
		await cdp.send("Emulation.setCPUThrottlingRate", { rate });
		const path = localePath(app, locale);
		await page.route("https://bench.test/**", (route) => {
			const { pathname } = new URL(route.request().url());
			if (pathname === path)
				return route.fulfill({ contentType: types[".html"], body: html });
			const file = join(directory, pathname);
			const type = types[extname(pathname)];
			if (type === undefined || !isFile(file)) {
				fail(`it asked for ${pathname}, which the build does not have`);
				return route.fulfill({ status: 404 });
			}
			if (type === types[".js"])
				scripts.push({ path: pathname, ...fileSize(file) });
			return route.fulfill({ contentType: type, path: file });
		});
		await page.goto(`https://bench.test${path}`);
		const outcome = await Promise.race([
			page
				.waitForFunction(() => window.bench, undefined, { timeout: PATIENCE })
				.then(async (handle) => ({ bench: await handle.jsonValue() })),
			fault.promise.then((text) => ({ fault: text })),
		]);
		if ("fault" in outcome)
			throw new Error(`The page failed: ${outcome.fault}`);
		const written = inline.map((code) => ({
			path: "index.html, inline",
			...sizeOf(code),
		}));
		return { bench: outcome.bench, scripts: [...scripts, ...written] };
	} finally {
		await context.close();
	}
}

const isFile = (file) =>
	statSync(file, { throwIfNoEntry: false })?.isFile() === true;
