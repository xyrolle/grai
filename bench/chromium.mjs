// A bench page in Chromium, opened as a reader in a locale opens it: with the app's cookie set and
// at the URL of the locale, for the libraries that read either, and its document served for it.
import { localePath } from "./request.mjs";

/** How long a page may take to set `window.bench`: a page of timed loops takes seconds. */
const PATIENCE = 120_000;

/**
 * Loads `html` as the app's page in `locale`, its CPU slowed down `rate` times, and returns what
 * the page sets as `window.bench` once it does.
 */
export async function benchPage(browser, app, locale, html, rate = 1) {
	const context = await browser.newContext();
	try {
		await context.addCookies([
			{
				name: app.compilerOptions.cookieName,
				value: locale,
				url: "https://bench.test/",
			},
		]);
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send("Emulation.setCPUThrottlingRate", { rate });
		await page.route("https://bench.test/**", (route) =>
			route.fulfill({ contentType: "text/html", body: html }),
		);
		await page.goto(`https://bench.test${localePath(app, locale)}`);
		const result = await page.waitForFunction(() => window.bench, undefined, {
			timeout: PATIENCE,
		});
		return await result.jsonValue();
	} finally {
		await context.close();
	}
}

/** A page whose `<html lang>` is `locale`, with `head`, `body` and then `script`, a module, inline. */
export function benchDocument(locale, { head = "", body = "", script }) {
	const code = script.replaceAll("</script", "<\\/script");
	return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">${head}</head><body>${body}<script type="module">${code}</script></body></html>`;
}
