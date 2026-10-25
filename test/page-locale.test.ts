import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build, createServer } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Your cart" },
	ro: { title: "Coșul tău" },
	ar: { title: "سلتك" },
};

const page = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/main.js"></script></head><body></body></html>`;
/** The page's code: its title, and a switch the tests call as a visitor would. */
const main = `import { m } from "./out/messages.js";
import { setLocale } from "./out/runtime.js";
document.body.textContent = m.title();
window.switchTo = (locale) => setLocale(locale);
`;

/** A project of one page, with the config's strategy. */
function site(config: Record<string, unknown>) {
	const { dir } = project(catalogs, config);
	writeFileSync(join(dir, "index.html"), page);
	writeFileSync(join(dir, "main.js"), main);
	return dir;
}

/** A static build of the site. */
async function built(dir: string) {
	await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		build: { outDir: join(dir, "dist") },
	});
	return { dist: join(dir, "dist") };
}

type Visit = {
	/** What a server makes of the built page before sending it. */
	served?: (html: string) => string;
	/** What the visitor stored before. */
	stored?: Record<string, string>;
};

/** A visitor whose browser is in Romanian, as Moldova has it, opening a built site at `url`. */
async function visit(
	dist: string,
	url: string,
	{ served = (html) => html, stored }: Visit,
) {
	const browser = await chromium.launch();
	onTestFinished(() => browser.close());
	const context = await browser.newContext({ locale: "ro-MD" });
	if (stored !== undefined) {
		await context.addInitScript(
			`for (const [key, value] of ${JSON.stringify(Object.entries(stored))}) localStorage.setItem(key, value);`,
		);
	}
	const tab = await context.newPage();
	await tab.route("http://grai.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		const file = path === "/" ? "index.html" : path.slice(1);
		const html = file.endsWith(".html");
		const body = readFileSync(join(dist, file), "utf8");
		return route.fulfill({
			body: html ? served(body) : body,
			contentType: html ? "text/html" : "text/javascript",
		});
	});
	await tab.goto(`http://grai.test${url}`);
	await tab.waitForFunction(`document.body.textContent !== ""`);
	// Strings, not functions: the test's TypeScript has no DOM types.
	const seen = () =>
		tab.evaluate(
			`[document.documentElement.lang, document.documentElement.dir, document.body.textContent].join(" ")`,
		);
	return { tab, seen };
}

describe("a page's locale, when no server picks it", () => {
	it("is the browser's language, matched as the server matches it", async () => {
		const { dist } = await built(site({ strategy: ["preferredLanguage"] }));
		const { seen } = await visit(dist, "/", {});

		expect(await seen()).toBe("ro ltr Coșul tău");
	});

	it("is the visitor's stored choice ahead of the browser's language, once setLocale stores it", async () => {
		const { dist } = await built(
			site({
				strategy: ["localStorage", "preferredLanguage"],
				localStorageKey: "locale",
			}),
		);
		const { tab, seen } = await visit(dist, "/", {});
		expect(await seen()).toBe("ro ltr Coșul tău");

		const reloaded = tab.waitForEvent("load");
		await tab.evaluate(`setTimeout(() => switchTo("ar"))`);
		await reloaded;
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await seen()).toBe("ar rtl سلتك");
	});

	it("is the query parameter's, ahead of the stored choice, when the strategy lists it first", async () => {
		const { dist } = await built(
			site({
				strategy: ["query", "localStorage", "preferredLanguage"],
				queryParameter: "lng",
				localStorageKey: "locale",
			}),
		);
		const stored = { locale: "en" };

		expect(await (await visit(dist, "/?lng=ar", { stored })).seen()).toBe(
			"ar rtl سلتك",
		);
		expect(await (await visit(dist, "/", { stored })).seen()).toBe(
			"en ltr Your cart",
		);
	});

	it("is the one a server drew the page in, with its <html lang>", async () => {
		const { dist } = await built(site({ strategy: ["preferredLanguage"] }));
		const { seen } = await visit(dist, "/", {
			served: (html) => html.replace("<html>", '<html lang="ar" dir="rtl">'),
		});

		expect(await seen()).toBe("ar rtl سلتك");
	});

	it("is picked the same way by the dev server", async () => {
		const dir = site({ strategy: ["preferredLanguage"] });
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: { ignored: ["**/index.html", "**/main.js"] } },
			plugins: [grai()],
		});
		await server.listen();
		onTestFinished(() => server.close());
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const context = await browser.newContext({ locale: "ro-MD" });
		const tab = await context.newPage();
		await tab.goto(server.resolvedUrls?.local[0] ?? "");
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(
			await tab.evaluate(
				`document.documentElement.lang + " " + document.body.textContent`,
			),
		).toBe("ro Coșul tău");
	});
});
