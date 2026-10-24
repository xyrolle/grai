import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";
import { type Messages, project } from "./project.ts";

const catalogs = {
	en: { title: "Your cart" },
	de: { title: "Ihr Warenkorb" },
	ar: { title: "سلتك" },
};

/** A project's output: its messages, runtime and middleware. */
async function output(config: Record<string, unknown> = {}) {
	const { dir, load } = project(catalogs, config);
	const { m, runtime } = await load();
	const server = await import(
		pathToFileURL(join(dir, "out", "server.js")).href
	);
	return {
		m,
		runtime,
		middleware: server.middleware as <Result>(
			request: Request,
			handler: (resolved: { request: Request; locale: string }) => Result,
		) => Result,
	};
}

describe("outside a request", () => {
	it("renders in the base locale, then in the locale setLocale sets for the process", async () => {
		const { m, runtime } = await output();

		expect([m.title?.(), runtime.getLocale()]).toEqual(["Your cart", "en"]);
		runtime.setLocale("de", { reload: false });
		expect([m.title?.(), runtime.getLocale()]).toEqual(["Ihr Warenkorb", "de"]);
	});
});

describe("the middleware", () => {
	const config = {
		strategy: ["cookie", "url", "preferredLanguage"],
		cookieName: "lang",
	};
	const localeOf = async (
		m: Messages,
		middleware: Awaited<ReturnType<typeof output>>["middleware"],
		path: string,
		headers: Record<string, string>,
	) =>
		middleware(
			new Request(`https://shop.test${path}`, { headers }),
			({ locale }) => [locale, m.title?.()],
		);

	it("binds the locale the request names, by the strategy's order, else the base locale", async () => {
		const { m, middleware } = await output(config);

		expect(
			await localeOf(m, middleware, "/de/cart", {
				cookie: "theme=dark; lang=ar",
			}),
		).toEqual(["ar", "سلتك"]);
		expect(
			await localeOf(m, middleware, "/de/cart", { cookie: "lang=fr" }),
		).toEqual(["de", "Ihr Warenkorb"]);
		expect(await localeOf(m, middleware, "/cart", {})).toEqual([
			"en",
			"Your cart",
		]);
	});

	it("matches Accept-Language by weight, then by language", async () => {
		const { m, middleware } = await output({ strategy: ["preferredLanguage"] });

		expect(
			await localeOf(m, middleware, "/", {
				"accept-language": "fr;q=0.9, de-AT;q=0.8, en;q=0.1",
			}),
		).toEqual(["de", "Ihr Warenkorb"]);
		expect(
			await localeOf(m, middleware, "/", { "accept-language": "fr, *;q=0.5" }),
		).toEqual(["en", "Your cart"]);
	});

	it("keeps each request's locale while requests interleave", async () => {
		const { m, middleware } = await output(config);
		let release = () => {};
		const allStarted = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started = 0;
		const render = (cookie: string) =>
			middleware(
				new Request("https://shop.test/", { headers: { cookie } }),
				async () => {
					const before = m.title?.();
					if (++started === 3) release();
					await allStarted;
					return [before, m.title?.()];
				},
			);

		expect(
			await Promise.all([
				render("lang=de"),
				render("lang=ar"),
				render("lang=en"),
			]),
		).toEqual([
			["Ihr Warenkorb", "Ihr Warenkorb"],
			["سلتك", "سلتك"],
			["Your cart", "Your cart"],
		]);
	});

	it("lets setLocale change the locale for the rest of the request only", async () => {
		const { m, runtime, middleware } = await output(config);
		const inside = await middleware(
			new Request("https://shop.test/"),
			async () => {
				runtime.setLocale("de");
				await Promise.resolve();
				return m.title?.();
			},
		);

		expect([inside, m.title?.()]).toEqual(["Ihr Warenkorb", "Your cart"]);
	});
});

describe("in a browser", () => {
	/** A page drawn in a locale: its `<html lang>`, its cookies and its reloads. */
	function page(lang: string) {
		const visited = {
			cookie: "",
			reloads: 0,
			href: "https://shop.test/de/cart?step=2",
		};
		Object.assign(globalThis, {
			document: {
				documentElement: { lang },
				set cookie(value: string) {
					visited.cookie = value;
				},
			},
			location: {
				reload: () => visited.reloads++,
				get href() {
					return visited.href;
				},
				set href(value: string) {
					visited.href = value;
				},
			},
		});
		onTestFinished(() => {
			Reflect.deleteProperty(globalThis, "document");
			Reflect.deleteProperty(globalThis, "location");
		});
		return visited;
	}

	it("renders in the page's locale, and setLocale keeps a new one in its cookie, then reloads", async () => {
		const visited = page("de");
		const { m, runtime } = await output({
			strategy: ["cookie"],
			cookieName: "lang",
		});

		expect([runtime.getLocale(), m.title?.()]).toEqual(["de", "Ihr Warenkorb"]);
		runtime.setLocale("ar");
		expect(visited).toEqual({
			cookie: "lang=ar; path=/; max-age=34560000; samesite=lax",
			reloads: 1,
			href: "https://shop.test/de/cart?step=2",
		});
	});

	it("sets <html lang> and dir with setLocale, which without a reload renders the next messages in it", async () => {
		const { dir, load } = project(catalogs);
		await load();
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const tab = await browser.newPage();
		await tab.route("http://grai.test/**", (route) => {
			const path = new URL(route.request().url()).pathname;
			return path === "/"
				? route.fulfill({
						contentType: "text/html",
						body: `<!doctype html><html lang="de" dir="ltr"><script type="module">
import { m } from "/out/messages.js";
import { getLocale, setLocale } from "/out/runtime.js";
const seen = () => [document.documentElement.lang, document.documentElement.dir, getLocale(), m.title()].join(" ");
const before = seen();
setLocale("ar", { reload: false });
document.body.textContent = before + " | " + seen();
</script>`,
					})
				: route.fulfill({
						contentType: "text/javascript",
						body: readFileSync(join(dir, path)),
					});
		});
		await tab.goto("http://grai.test/");
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await tab.textContent("body")).toBe(
			"de ltr de Ihr Warenkorb | ar rtl ar سلتك",
		);
	});

	it("goes to the new locale's URL with the url strategy", async () => {
		const visited = page("de");
		const { runtime } = await output({ strategy: ["url"] });
		runtime.setLocale("ar");

		expect(visited.href).toBe("https://shop.test/ar/cart?step=2");
		expect(visited.reloads).toBe(0);
	});
});

it("localizes paths and URLs by their first segment, the base locale having none", async () => {
	const { runtime } = await output();
	runtime.setLocale("de", { reload: false });

	expect(runtime.localizeHref("/cart?step=2#total")).toBe(
		"/de/cart?step=2#total",
	);
	expect(runtime.localizeHref("/ar/cart", { locale: "en" })).toBe("/cart");
	expect(runtime.localizeHref("https://other.test/cart")).toBe(
		"https://other.test/cart",
	);
	expect(String(runtime.deLocalizeUrl("https://shop.test/ar/cart"))).toBe(
		"https://shop.test/cart",
	);
	expect(
		String(runtime.localizeUrl("https://shop.test/cart", { locale: "ar" })),
	).toBe("https://shop.test/ar/cart");
	expect([
		runtime.extractLocaleFromUrl("https://shop.test/ar/x"),
		runtime.extractLocaleFromUrl("https://shop.test/x"),
	]).toEqual(["ar", "en"]);
	expect([runtime.getTextDirection("ar"), runtime.getTextDirection()]).toEqual([
		"rtl",
		"ltr",
	]);
});
