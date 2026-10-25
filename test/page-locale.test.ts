import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build, createServer, type InlineConfig } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import type { GraiOptions } from "../src/vite-plugin.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Your cart", checkout: "Checkout" },
	ro: { title: "Coșul tău", checkout: "Plata" },
	ar: { title: "سلتك", checkout: "الدفع" },
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

/** A static build of the site, with each message chunk's copies per locale unless told not to. */
async function built(
	dir: string,
	vite: InlineConfig = {},
	options: GraiOptions = { localeChunks: true },
) {
	await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai(options)],
		build: { outDir: join(dir, "dist") },
		...vite,
	});
	return { dist: join(dir, "dist") };
}

type Visit = {
	/** What a server makes of the built page before sending it. */
	served?: (html: string) => string;
	/** What the visitor stored before. */
	stored?: Record<string, string>;
};

/**
 * A visitor whose browser is in Romanian, as Moldova has it, opening a built site at `url`: what
 * it sees, and the message chunks its browser requested.
 */
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
	const requested: string[] = [];
	await tab.route("http://grai.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		requested.push(path);
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
	/** The message chunks the browser requested: the shared ones under grai/, and the copies. */
	const messageFiles = () =>
		requested.filter((path) => /\/grai(-[^/]+)?\/[^/]+$/.test(path));
	return { tab, seen, messageFiles };
}

describe("a page's locale, when no server picks it", () => {
	it("is the browser's language, matched as the server matches it, and the page loads only its copies", async () => {
		const { dist } = await built(site({ strategy: ["preferredLanguage"] }));
		const { seen, messageFiles } = await visit(dist, "/", {});

		expect(await seen()).toBe("ro ltr Coșul tău");
		expect(messageFiles().length).toBeGreaterThan(0);
		expect(messageFiles().every((path) => path.includes("/grai-ro/"))).toBe(
			true,
		);
	});

	it("is picked without localeChunks too, the page then loading the message chunks every locale shares", async () => {
		const { dist } = await built(
			site({ strategy: ["preferredLanguage"] }),
			{},
			{},
		);
		const { seen, messageFiles } = await visit(dist, "/", {});

		expect(await seen()).toBe("ro ltr Coșul tău");
		expect(messageFiles().length).toBeGreaterThan(0);
		expect(messageFiles().every((path) => /\/grai\/[^/]+$/.test(path))).toBe(
			true,
		);
	});

	it("is the visitor's stored choice ahead of the browser's language, once setLocale stores it", async () => {
		const { dist } = await built(
			site({
				strategy: ["localStorage", "preferredLanguage"],
				localStorageKey: "locale",
			}),
		);
		const { tab, seen, messageFiles } = await visit(dist, "/", {});
		expect(await seen()).toBe("ro ltr Coșul tău");

		const reloaded = tab.waitForEvent("load");
		await tab.evaluate(`setTimeout(() => switchTo("ar"))`);
		await reloaded;
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await seen()).toBe("ar rtl سلتك");
		expect(messageFiles().some((path) => path.includes("/grai-ar/"))).toBe(
			true,
		);
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
		const { seen, messageFiles } = await visit(dist, "/", {
			served: (html) => html.replace("<html>", '<html lang="ar" dir="rtl">'),
		});

		expect(await seen()).toBe("ar rtl سلتك");
		expect(messageFiles().every((path) => path.includes("/grai-ar/"))).toBe(
			true,
		);
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

it("loads the messages of a module a page imports later from its locale's copies too", async () => {
	const dir = site({ strategy: ["preferredLanguage"] });
	writeFileSync(
		join(dir, "main.js"),
		`import { m } from "./out/messages.js";
import("./later.js").then(({ show }) => show(m.title()));
`,
	);
	writeFileSync(
		join(dir, "later.js"),
		`import { m } from "./out/messages.js";
export const show = (title) => { document.body.textContent = title + " " + m.checkout(); };
`,
	);
	const { dist } = await built(dir);
	const { seen, messageFiles } = await visit(dist, "/", {});

	expect(await seen()).toBe("ro ltr Coșul tău Plata");
	expect(messageFiles().length).toBeGreaterThan(1);
	expect(messageFiles().every((path) => path.includes("/grai-ro/"))).toBe(true);
});

it("points a page in a subdirectory, under a relative base, at the copies from its own directory", async () => {
	const dir = site({ strategy: ["preferredLanguage"] });
	mkdirSync(join(dir, "nested"));
	writeFileSync(
		join(dir, "nested", "index.html"),
		page.replace("/main.js", "../main.js"),
	);
	const { dist } = await built(dir, {
		base: "./",
		build: {
			outDir: join(dir, "dist"),
			rolldownOptions: { input: join(dir, "nested", "index.html") },
		},
	});
	const chunks = readFileSync(join(dist, "nested", "index.html"), "utf8").match(
		/data-grai-chunks="([^"]*)"/,
	)?.[1];

	expect(JSON.parse((chunks ?? "").replaceAll("&quot;", '"'))).toEqual({
		imports: { "../assets/grai/": "../assets/grai-{locale}/" },
		preload: [expect.stringMatching(/^\.\.\/assets\/grai-\{locale\}\//)],
	});
});
