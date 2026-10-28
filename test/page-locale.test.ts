import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
	build,
	createLogger,
	createServer,
	type InlineConfig,
	type Plugin,
} from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai as graiSvelte } from "../src/svelte.ts";
import { grai as graiSvelteKit } from "../src/sveltekit-vite.ts";
import { grai } from "../src/vite.ts";
import { type GraiOptions, graiPlugin } from "../src/vite-plugin.ts";
import { fixtures, project } from "./project.ts";

const catalogs = {
	en: { title: "Your cart", checkout: "Checkout" },
	ro: { title: "Coșul tău", checkout: "Plata" },
	ar: { title: "سلتك", checkout: "الدفع" },
};

const page = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/main.js"></script></head><body></body></html>`;
/**
 * The page's code: its title, the switches the tests call as a visitor would, and what the page
 * holds now: its `<html lang>`, its locale and its title.
 */
const main = `import { m } from "./out/messages.js";
import { getLocale, setLocale } from "./out/runtime.js";
document.body.textContent = m.title();
window.switchTo = (locale) => setLocale(locale);
window.keep = (locale) => setLocale(locale, { reload: false });
window.holds = () => [document.documentElement.lang, getLocale(), m.title()].join(" ");
window.inEnglish = () => {
	try {
		return m.title({}, { locale: "en" });
	} catch (error) {
		return error.message;
	}
};
`;

/** A project of one page, with the config's strategy. */
function site(config: Record<string, unknown>, html = page) {
	const { dir } = project(catalogs, config);
	writeFileSync(join(dir, "index.html"), html);
	writeFileSync(join(dir, "main.js"), main);
	return dir;
}

/**
 * A static build of the site, with each message chunk's copies per locale unless told not to,
 * and the lines its log wrote.
 */
async function built(
	dir: string,
	vite: InlineConfig = {},
	options: GraiOptions = { localeChunks: true },
) {
	const logged: string[] = [];
	const customLogger = createLogger("info");
	customLogger.info = (line) => {
		logged.push(line);
	};
	await build({
		root: dir,
		configFile: false,
		customLogger,
		plugins: [grai(options)],
		build: { outDir: join(dir, "dist") },
		...vite,
	});
	return { dist: join(dir, "dist"), logged };
}

type Visit = {
	/** The response headers of every file. */
	headers?: Record<string, string>;
	/** What a server makes of the built page before sending it. */
	served?: (html: string) => string;
	/** What the visitor stored before, in `localStorage`. */
	stored?: Record<string, string>;
	/** The visitor's cookies. */
	cookies?: Record<string, string>;
	/** The path the site is served under, which every page of it shows: the build's `base`. */
	base?: string;
	/** The origin the site is served at. */
	origin?: string;
};

/**
 * A visitor whose browser is in Romanian, as Moldova has it, opening a built site at `url`: what
 * it sees, the message chunks its browser requested, and what its Content Security Policy refused.
 */
async function visit(
	dist: string,
	url: string,
	{
		headers = {},
		served = (html) => html,
		stored,
		cookies = {},
		base = "/",
		origin = "http://grai.test",
	}: Visit,
) {
	const browser = await chromium.launch();
	onTestFinished(() => browser.close());
	const context = await browser.newContext({ locale: "ro-MD" });
	await context.addCookies(
		Object.entries(cookies).map(([name, value]) => ({
			name,
			value,
			url: origin,
		})),
	);
	if (stored !== undefined) {
		await context.addInitScript(
			`for (const [key, value] of ${JSON.stringify(Object.entries(stored))}) localStorage.setItem(key, value);`,
		);
	}
	const tab = await context.newPage();
	const refused: string[] = [];
	tab.on("console", (message) => {
		if (message.text().includes("Content Security Policy"))
			refused.push(message.text());
	});
	const requested: string[] = [];
	await tab.route(`${origin}/**`, (route) => {
		const path = new URL(route.request().url()).pathname;
		requested.push(path);
		// A page of the site is its one document; any other file is at its path under the base.
		const within = path.startsWith(base) ? path.slice(base.length - 1) : path;
		const file = within.endsWith("/") ? "index.html" : within.slice(1);
		const html = file.endsWith(".html");
		const body = readFileSync(join(dist, file), "utf8");
		return route.fulfill({
			body: html ? served(body) : body,
			contentType: html ? "text/html" : "text/javascript",
			headers,
		});
	});
	await tab.goto(`${origin}${url}`);
	await tab.waitForFunction(`document.body.textContent !== ""`);
	// Strings, not functions: the test's TypeScript has no DOM types.
	const seen = () =>
		tab.evaluate(
			`[document.documentElement.lang, document.documentElement.dir, document.body.textContent].join(" ")`,
		);
	/** The message chunks the browser requested: the shared ones under grai/, and the copies. */
	const messageFiles = () =>
		requested.filter((path) => /\/grai(-[^/]+)?\/[^/]+$/.test(path));
	return { tab, seen, messageFiles, refused };
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

	it("is the visitor's stored choice on a page built with an <html lang>, which is only its default", async () => {
		const { dist } = await built(
			site(
				{ strategy: ["cookie", "preferredLanguage"], cookieName: "lang" },
				page.replace("<html>", '<html lang="en">'),
			),
		);
		const { seen, messageFiles } = await visit(dist, "/", {
			cookies: { lang: "ar" },
		});

		expect(await seen()).toBe("ar rtl سلتك");
		expect(messageFiles().every((path) => path.includes("/grai-ar/"))).toBe(
			true,
		);
	});

	it("is the <html lang> the page was built with, where no place of the strategy names one", async () => {
		const { dist } = await built(
			site(
				{ strategy: ["cookie"], cookieName: "lang" },
				page.replace("<html>", '<html lang="ar">'),
			),
		);
		const { seen, messageFiles } = await visit(dist, "/", {});

		expect(await seen()).toBe("ar rtl سلتك");
		expect(messageFiles().every((path) => path.includes("/grai-ar/"))).toBe(
			true,
		);
	});

	it("is the one a server drew the page in, with an <html lang> other than the page was built with", async () => {
		const { dist } = await built(
			site(
				{ strategy: ["preferredLanguage"] },
				page.replace("<html>", '<html lang="en">'),
			),
		);
		const { seen, messageFiles } = await visit(dist, "/", {
			served: (html) =>
				html.replace('<html lang="en">', '<html lang="ar" dir="rtl">'),
		});

		expect(await seen()).toBe("ar rtl سلتك");
		expect(messageFiles().every((path) => path.includes("/grai-ar/"))).toBe(
			true,
		);
	});

	it("is kept for the next load by setLocale with { reload: false }, and the page keeps its words", async () => {
		const { dist } = await built(
			site({
				strategy: ["localStorage", "preferredLanguage"],
				localStorageKey: "locale",
			}),
		);
		const { tab, seen } = await visit(dist, "/", {});
		await tab.evaluate(`keep("ar")`);

		expect(await tab.evaluate(`holds()`)).toBe("ro ro Coșul tău");
		await tab.reload();
		await tab.waitForFunction(`document.body.textContent !== ""`);
		expect(await seen()).toBe("ar rtl سلتك");
	});

	it("is not changed by setLocale where the strategy keeps the choice nowhere, which says so", async () => {
		const { dist } = await built(site({}));
		const { tab } = await visit(dist, "/", {});

		expect(
			await tab.evaluate(
				`(() => { try { switchTo("ar"); return "reloading"; } catch (error) { return error.code; } })()`,
			),
		).toBe("locale-unkept");
		expect(await tab.evaluate(`holds()`)).toBe("en en Your cart");
	});

	it("is the one the URL names after the base path the site is served under", async () => {
		const { dist } = await built(
			site({ strategy: ["url"], basePath: "/shop" }),
			{ base: "/shop/" },
		);
		const { seen } = await visit(dist, "/shop/ar/", { base: "/shop/" });

		expect(await seen()).toBe("ar rtl سلتك");
	});

	it("is the one whose host the site is served at, with a domain per locale", async () => {
		const { dist } = await built(
			site({
				strategy: ["url"],
				domains: { en: "grai.test", ro: "ro.grai.test", ar: "ar.grai.test" },
			}),
		);
		const { seen } = await visit(dist, "/", { origin: "http://ar.grai.test" });

		expect(await seen()).toBe("ar rtl سلتك");
	});

	it("is picked the same way by the dev server", async () => {
		const dir = site({ strategy: ["preferredLanguage"] });
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: fixtures },
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

describe("a page the dev server serves", () => {
	/**
	 * The dev server of a site, and a browser page in the `language` it prefers, which records the
	 * paths of the dev modules of keys.js it loads.
	 */
	async function devPage(
		dir: string,
		language: string,
		plugins: Plugin[] = grai(),
	) {
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: fixtures },
			plugins,
		});
		await server.listen();
		onTestFinished(() => server.close());
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const context = await browser.newContext({ locale: language });
		const tab = await context.newPage();
		const keys: string[] = [];
		tab.on("request", (request) => {
			const { pathname } = new URL(request.url());
			if (pathname.includes("grai:keys")) keys.push(pathname);
		});
		return { origin: server.resolvedUrls?.local[0] ?? "", tab, keys };
	}

	it("loads its locale's words alone, through the import map its locale script writes", async () => {
		const { origin, tab, keys } = await devPage(
			site({ strategy: ["preferredLanguage"] }),
			"ro-MD",
		);
		await tab.goto(origin);
		await tab.waitForFunction(`document.body.textContent !== ""`);
		const served = await (
			await fetch(new URL("@id/__x00__grai:keys/ro", origin))
		).text();

		expect(await tab.evaluate("window.holds()")).toBe("ro ro Coșul tău");
		expect(keys).toEqual(["/@id/__x00__grai:keys/ro"]);
		expect([
			served.includes("Coșul tău"),
			served.includes("Your cart"),
			served.includes("سلتك"),
		]).toEqual([true, false, false]);
	});

	it("takes its locale's words alone through keys.js itself, with no import map, by its <html lang>", async () => {
		const dir = site(
			{ strategy: ["preferredLanguage"] },
			page.replace("<html>", '<html lang="ar">'),
		);
		const { origin, tab, keys } = await devPage(
			dir,
			"ro-MD",
			graiPlugin({}).plugins,
		);
		await tab.goto(origin);
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await tab.evaluate("window.holds()")).toBe("ar ar سلتك");
		expect(keys).toEqual(["/@id/__x00__grai:keys", "/@id/__x00__grai:keys/ar"]);
	});

	it("gives a module worker every locale's words, as a worker has no import map and no <html lang>", async () => {
		const dir = site({ strategy: ["preferredLanguage"] });
		writeFileSync(
			join(dir, "worker.js"),
			`import { m } from "./out/messages.js";
import { setLocale } from "./out/runtime.js";
const base = m.title();
setLocale("ar");
postMessage([base, m.title()]);
`,
		);
		writeFileSync(
			join(dir, "main.js"),
			`${main}
window.fromWorker = new Promise((resolve) => {
	const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
	worker.onmessage = (event) => resolve({ posted: event.data });
	worker.onerror = (event) => resolve({ error: event.message });
});
`,
		);
		const { origin, tab } = await devPage(dir, "ro-MD");
		await tab.goto(origin);

		expect(await tab.evaluate("window.fromWorker")).toEqual({
			posted: ["Your cart", "سلتك"],
		});
		expect(await tab.evaluate("window.holds()")).toBe("ro ro Coșul tău");
	});

	it("throws for a call in another locale, naming its key, as a page in its locale's words alone", async () => {
		const { origin, tab } = await devPage(
			site({ strategy: ["preferredLanguage"] }),
			"ro-MD",
		);
		await tab.goto(origin);
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await tab.evaluate("window.inEnglish()")).toBe(
			'title was called in "en", but this page renders in "ro" alone.',
		);
	});

	it("loads the other locale's words alone after setLocale switches to it", async () => {
		const { origin, tab, keys } = await devPage(
			site({ strategy: ["cookie", "preferredLanguage"], cookieName: "lang" }),
			"ro-MD",
		);
		await tab.goto(origin);
		await tab.waitForFunction(`document.body.textContent !== ""`);
		await Promise.all([
			tab.waitForEvent("load"),
			tab.evaluate("window.switchTo('ar')"),
		]);
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await tab.evaluate("window.holds()")).toBe("ar ar سلتك");
		expect(keys).toEqual([
			"/@id/__x00__grai:keys/ro",
			"/@id/__x00__grai:keys/ar",
		]);
	});

	it("serves no locale's words while a message of a locale the page does not load is invalid", async () => {
		const dir = site({ strategy: ["preferredLanguage"] });
		const catalog = join(dir, "messages", "ar.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"سلتك"', '"{$count :weekday}"'),
		);
		const { origin } = await devPage(dir, "ro-MD");
		const response = await fetch(new URL("@id/__x00__grai:keys/ro", origin));

		expect(response.status).toBe(500);
		expect(await response.text()).toContain("ar.json");
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

describe("a page's locale script under a Content Security Policy", () => {
	it("runs, and loads the locale's copies, with the hashes the build's log names", async () => {
		const { dist, logged } = await built(
			site({ strategy: ["preferredLanguage"] }),
		);
		const hashes = logged
			.join("\n")
			.match(/'sha256-[A-Za-z0-9+/=]+'/g)
			?.join(" ");
		const { seen, messageFiles, refused } = await visit(dist, "/", {
			headers: { "content-security-policy": `script-src 'self' ${hashes}` },
		});

		expect(await seen()).toBe("ro ltr Coșul tău");
		expect(messageFiles().every((path) => path.includes("/grai-ro/"))).toBe(
			true,
		);
		expect(refused).toEqual([]);
	});

	it("gives the import map it writes its nonce, under a policy that allows scripts by nonce", async () => {
		const { dist } = await built(site({ strategy: ["preferredLanguage"] }), {
			html: { cspNonce: "a-nonce" },
		});
		const { seen, messageFiles, refused } = await visit(dist, "/", {
			headers: { "content-security-policy": "script-src 'nonce-a-nonce'" },
		});

		expect(await seen()).toBe("ro ltr Coșul tău");
		expect(messageFiles().every((path) => path.includes("/grai-ro/"))).toBe(
			true,
		);
		expect(refused).toEqual([]);
	});
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

it("gives the locale script's index.html hook to the plugins of apps whose pages Vite serves alone, as SvelteKit warns of a plugin with one", () => {
	const hooked = (plugins: Plugin[]) =>
		plugins
			.filter((plugin) => plugin.transformIndexHtml !== undefined)
			.map((plugin) => plugin.name);

	expect(hooked(grai())).toEqual(["grai:page-locale"]);
	expect(hooked(graiSvelte())).toEqual(["grai:page-locale"]);
	expect(hooked(graiSvelteKit())).toEqual([]);
	// Astro's and Nuxt's, which draw their pages too.
	expect(hooked(graiPlugin({}).plugins)).toEqual([]);
});
