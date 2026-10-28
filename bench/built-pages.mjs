// A build of the app build-added builds (build-apps.mjs), checked in Chromium after its clock has
// stopped: each page opened at its path, as a reader opens it, with the build's files served from
// its directory, and the texts it draws compared with the texts it must draw. A request for a file
// the build does not have, an error in the page or in its console, or a text other than expected
// fails the check.
import { statSync } from "node:fs";
import { extname, join } from "node:path";

/** How long a page may take to draw its texts. */
const PATIENCE_MS = 30_000;
const types = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
};

const isFile = (file) =>
	statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/** Throws unless `shown` are `texts`, naming the first that differs. */
function compare(shown, texts, where) {
	const index = texts.findIndex((text, at) => shown[at] !== text);
	if (index === -1 && shown.length === texts.length) return;
	const at = index === -1 ? texts.length : index;
	throw new Error(
		`${where} draws ${shown.length} texts for ${texts.length}; text ${at} is ${JSON.stringify(shown[at])}, not ${JSON.stringify(texts[at])}.`,
	);
}

/** Opens every page of the build in `dist`, each of `pages` the texts its page must draw. */
export async function checkBuiltPages(browser, dist, pages) {
	const context = await browser.newContext();
	const faults = [];
	try {
		const page = await context.newPage();
		page.on("pageerror", (error) => faults.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") faults.push(message.text());
		});
		await page.route("https://bench.test/**", (route) => {
			const { pathname } = new URL(route.request().url());
			const file = /^\/\d+$/.test(pathname)
				? join(dist, "index.html")
				: join(dist, pathname);
			const type = types[extname(file)];
			if (type === undefined || !isFile(file)) {
				faults.push(`it asked for ${pathname}, which the build does not have`);
				return route.fulfill({ status: 404 });
			}
			return route.fulfill({ contentType: type, path: file });
		});
		for (const [index, texts] of pages.entries()) {
			const where = `${dist}, page ${index},`;
			await page.goto(`https://bench.test/${index}`);
			await page
				.waitForFunction((at) => window.rendered === at, index, {
					timeout: PATIENCE_MS,
				})
				.catch((error) => {
					throw new Error(
						`${where} drew nothing: ${faults.join("; ") || error.message}`,
					);
				});
			if (faults.length > 0)
				throw new Error(`${where} failed: ${faults.join("; ")}`);
			const shown = await page.$$eval("#texts li", (items) =>
				items.map((item) => item.textContent),
			);
			compare(shown, texts, where);
		}
	} finally {
		await context.close();
	}
}
