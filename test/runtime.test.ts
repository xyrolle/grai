import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";
import { type Messages, project, thrown } from "./project.ts";

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
		middleware: server.middleware as (
			request: Request,
			handler: (resolved: {
				request: Request;
				locale: string;
			}) => Response | Promise<Response>,
		) => Promise<Response>,
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
		strategy: ["cookie", "url"],
		cookieName: "lang",
	};
	const localeOf = async (
		m: Messages,
		middleware: Awaited<ReturnType<typeof output>>["middleware"],
		path: string,
		headers: Record<string, string>,
	) =>
		(
			await middleware(
				new Request(`https://shop.test${path}`, { headers }),
				({ locale }) => Response.json([locale, m.title?.()]),
			)
		).json();

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

	/** The locale the middleware gives each Accept-Language header, for a project of `locales`. */
	const acceptLanguage = async (locales: string[]) => {
		const { dir, load } = project(
			Object.fromEntries(locales.map((locale) => [locale, { title: locale }])),
			{ strategy: ["preferredLanguage"] },
		);
		await load();
		const { middleware } = await import(
			pathToFileURL(join(dir, "out", "server.js")).href
		);
		return (headers: string[]) =>
			Promise.all(
				headers.map(async (header) =>
					(
						await middleware(
							new Request("https://shop.test/", {
								headers: { "accept-language": header },
							}),
							({ locale }: { locale: string }) => new Response(locale),
						)
					).text(),
				),
			);
	};

	it("matches an Accept-Language tag as itself, then as each parent, as written and in its likely form, never as a sibling", async () => {
		const localesFor = await acceptLanguage([
			"en-US",
			"en",
			"zh-Hans",
			"zh-Hant",
			"pt-BR",
		]);

		expect(
			await localesFor([
				"en-GB",
				"zh-Hant-TW",
				"zh-Hant-HK",
				"zh-TW",
				"zh-CN",
				"pt-PT",
				"zh-Latn",
				"sr",
			]),
		).toEqual([
			"en",
			"zh-Hant",
			"zh-Hant",
			"zh-Hant",
			"zh-Hans",
			"en-US",
			"en-US",
			"en-US",
		]);
		const regional = await acceptLanguage(["en-GB", "en-US", "de"]);
		expect(await regional(["en-AU, de;q=0.9", "en, de;q=0.9"])).toEqual([
			"de",
			"en-US",
		]);
	});

	it("keeps out a language the request refuses, and takes * as any language it names no other way", async () => {
		const localesFor = await acceptLanguage(["en", "de", "fr"]);

		expect(
			await localesFor([
				"en;q=0, *;q=1",
				"en;q=0.5, *",
				"de-AT;q=0, de;q=0.9, fr;q=0.8",
				"ro, *;q=0.5",
			]),
		).toEqual(["de", "de", "de", "en"]);
	});

	it("leaves out an entry whose weight is not a q-value, or whose tag is not a language range", async () => {
		const localesFor = await acceptLanguage(["en", "de"]);

		expect(
			await localesFor([
				"de;q=2, en;q=0.5",
				"de;q=.5, en;q=0.4",
				"de_DE, en;q=0.1",
				"de;Q=0, en;q=0.9",
				"de;Q=0.9, en;q=0.5",
			]),
		).toEqual(["en", "en", "en", "en", "de"]);
	});

	/**
	 * Each request's title before and after an await, every request started before any renders
	 * again. A request with `switchTo` calls setLocale before it awaits.
	 */
	const interleaved = async (
		{ m, runtime, middleware }: Awaited<ReturnType<typeof output>>,
		requests: { cookie: string; switchTo?: string }[],
	) => {
		let release = () => {};
		const allStarted = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started = 0;
		return Promise.all(
			requests.map(async ({ cookie, switchTo }) =>
				(
					await middleware(
						new Request("https://shop.test/", { headers: { cookie } }),
						async () => {
							const before = m.title?.();
							if (switchTo !== undefined) runtime.setLocale(switchTo);
							if (++started === requests.length) release();
							await allStarted;
							return Response.json([before, m.title?.()]);
						},
					)
				).json(),
			),
		);
	};

	it("passes over localStorage, which a request does not carry, to the strategy's next place", async () => {
		const { m, middleware } = await output({
			strategy: ["localStorage", "preferredLanguage"],
			localStorageKey: "locale",
		});

		expect(
			await localeOf(m, middleware, "/", { "accept-language": "de" }),
		).toEqual(["de", "Ihr Warenkorb"]);
	});

	it("keeps each request's locale while requests interleave", async () => {
		const rendered = await interleaved(await output(config), [
			{ cookie: "lang=de" },
			{ cookie: "lang=ar" },
			{ cookie: "lang=en" },
		]);

		expect(rendered).toEqual([
			["Ihr Warenkorb", "Ihr Warenkorb"],
			["سلتك", "سلتك"],
			["Your cart", "Your cart"],
		]);
	});

	it("lets setLocale switch only its own request while requests interleave", async () => {
		const rendered = await interleaved(await output(config), [
			{ cookie: "lang=de", switchTo: "ar" },
			{ cookie: "lang=en" },
		]);

		expect(rendered).toEqual([
			["Ihr Warenkorb", "سلتك"],
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
				return new Response(m.title?.());
			},
		);

		expect([await inside.text(), m.title?.()]).toEqual([
			"Ihr Warenkorb",
			"Your cart",
		]);
	});
});

describe("the response's Vary", () => {
	/** The `Vary` of the response the middleware gives for `response`, by `strategy`. */
	const varyOf = async (
		strategy: string[],
		response = () => new Response("Your cart"),
	) => {
		const { middleware } = await output({
			strategy,
			...(strategy.includes("cookie") ? { cookieName: "lang" } : {}),
			...(strategy.includes("localStorage") ? { localStorageKey: "lang" } : {}),
		});
		return (
			await middleware(new Request("https://shop.test/cart"), response)
		).headers.get("vary");
	};

	it.each([
		[[], null],
		[["cookie"], "Cookie"],
		[["preferredLanguage"], "Accept-Language"],
		[["url"], null],
		[["cookie", "preferredLanguage"], "Cookie, Accept-Language"],
		[["preferredLanguage", "cookie"], "Accept-Language, Cookie"],
		[["cookie", "url"], "Cookie"],
		[["preferredLanguage", "url"], "Accept-Language"],
		[["cookie", "preferredLanguage", "url"], "Cookie, Accept-Language"],
		[["localStorage", "preferredLanguage"], "Accept-Language"],
	])("with the strategy %j, lists %j", async (strategy, vary) => {
		expect(await varyOf(strategy)).toBe(vary);
	});

	it("appends to the handler's own", async () => {
		const vary = await varyOf(
			["cookie", "preferredLanguage"],
			() => new Response("", { headers: { vary: "Accept-Encoding" } }),
		);

		expect(vary).toBe("Accept-Encoding, Cookie, Accept-Language");
	});

	it("varies a response whose headers are immutable, as fetch() gives, through a copy", async () => {
		const { middleware } = await output({ strategy: ["preferredLanguage"] });
		const response = await middleware(new Request("https://shop.test/"), () =>
			Response.redirect("https://shop.test/cart", 307),
		);

		expect([
			response.status,
			response.headers.get("location"),
			response.headers.get("vary"),
		]).toEqual([307, "https://shop.test/cart", "Accept-Language"]);
	});
});

describe("with every locale's paths prefixed", () => {
	const config = {
		strategy: ["url", "cookie", "preferredLanguage"],
		cookieName: "lang",
		localePrefix: "always",
	};
	const answer = async (
		middleware: Awaited<ReturnType<typeof output>>["middleware"],
		path: string,
		init: RequestInit = {},
	) => {
		const response = await middleware(
			new Request(`https://shop.test${path}`, init),
			({ locale }) => new Response(locale),
		);
		return [
			response.status,
			response.headers.get("location") ?? (await response.text()),
		];
	};

	it("takes the locale a path names, and sends a page without one to the locale the request prefers", async () => {
		const { middleware } = await output(config);

		expect([
			await answer(middleware, "/en/cart"),
			await answer(middleware, "/de/cart"),
			await answer(middleware, "/cart?step=2", {
				headers: { cookie: "lang=ar" },
			}),
			await answer(middleware, "/cart", {
				headers: { "accept-language": "de" },
			}),
			await answer(middleware, "/"),
			await answer(middleware, "/cart", {
				method: "POST",
				headers: { cookie: "lang=de" },
			}),
		]).toEqual([
			[200, "en"],
			[200, "de"],
			[307, "https://shop.test/ar/cart?step=2"],
			[307, "https://shop.test/de/cart"],
			[307, "https://shop.test/en"],
			[200, "de"],
		]);
	});

	it("gives the base locale's paths its prefix too", async () => {
		const { runtime } = await output(config);

		expect([
			runtime.localizeHref("/cart", { locale: "en" }),
			runtime.localizeHref("/de/cart", { locale: "en" }),
			String(runtime.deLocalizeUrl("https://shop.test/en/cart")),
			runtime.extractLocaleFromUrl("https://shop.test/en/x"),
		]).toEqual(["/en/cart", "/en/cart", "https://shop.test/cart", "en"]);
	});
});

describe("with paths the url strategy leaves alone", () => {
	const answer = async (
		middleware: Awaited<ReturnType<typeof output>>["middleware"],
		path: string,
		cookie = "",
	) => {
		const response = await middleware(
			new Request(`https://shop.test${path}`, { headers: { cookie } }),
			({ locale }) => new Response(locale),
		);
		return [
			response.status,
			response.headers.get("location") ?? (await response.text()),
		];
	};

	it("finds an app page's locale by the strategies after url, and links to it without a prefix", async () => {
		const { middleware, runtime } = await output({
			strategy: ["url", "cookie"],
			cookieName: "lang",
			unlocalizedPaths: ["/app", "/app/**"],
		});

		expect([
			await answer(middleware, "/de/cart", "lang=ar"),
			await answer(middleware, "/app/orders", "lang=ar"),
			await answer(middleware, "/app"),
			runtime.localizeHref("/app/orders", { locale: "de" }),
			runtime.localizeHref("/cart", { locale: "de" }),
		]).toEqual([
			[200, "de"],
			[200, "ar"],
			[200, "en"],
			"/app/orders",
			"/de/cart",
		]);
	});

	it("sends no app page to a prefixed path, with every locale's paths prefixed", async () => {
		const { middleware } = await output({
			strategy: ["url", "cookie"],
			cookieName: "lang",
			localePrefix: "always",
			unlocalizedPaths: ["/api/**"],
		});

		expect([
			await answer(middleware, "/api/orders", "lang=de"),
			await answer(middleware, "/cart", "lang=de"),
		]).toEqual([
			[200, "de"],
			[307, "https://shop.test/de/cart"],
		]);
	});
});

it("reads and writes a locale's own prefix, where the config gives one", async () => {
	const { runtime, middleware } = await output({
		strategy: ["url"],
		localePrefixes: { ar: "arabic" },
	});
	const localeAt = async (path: string) =>
		(
			await middleware(
				new Request(`https://shop.test${path}`),
				({ locale }) => new Response(locale),
			)
		).text();

	expect([
		await localeAt("/arabic/cart"),
		await localeAt("/ar/cart"),
		await localeAt("/de/cart"),
		runtime.localizeHref("/cart", { locale: "ar" }),
		runtime.localizeHref("/arabic/cart", { locale: "de" }),
		String(runtime.deLocalizeUrl("https://shop.test/arabic/cart")),
		runtime.extractLocaleFromUrl("https://shop.test/arabic/x"),
	]).toEqual([
		"ar",
		"en",
		"de",
		"/arabic/cart",
		"/de/cart",
		"https://shop.test/cart",
		"ar",
	]);
});

describe("in a browser", () => {
	/** A page drawn in a locale: its `<html lang>`, its cookies, its storage and its reloads. */
	function page(lang: string) {
		const visited = {
			cookie: "",
			stored: new Map<string, string>(),
			reloads: 0,
			href: "https://shop.test/de/cart?step=2",
		};
		Object.assign(globalThis, {
			localStorage: {
				setItem: (key: string, value: string) => visited.stored.set(key, value),
			},
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
				get protocol() {
					return new URL(visited.href).protocol;
				},
				set href(value: string) {
					visited.href = value;
				},
			},
		});
		onTestFinished(() => {
			Reflect.deleteProperty(globalThis, "localStorage");
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
			cookie: "lang=ar; path=/; max-age=34560000; samesite=lax; secure",
			stored: new Map(),
			reloads: 1,
			href: "https://shop.test/de/cart?step=2",
		});
	});

	it("keeps the page's own locale in its cookie without reloading the page", async () => {
		const visited = page("de");
		const { runtime } = await output({
			strategy: ["cookie"],
			cookieName: "lang",
		});

		runtime.setLocale("de");
		expect(visited).toEqual({
			cookie: "lang=de; path=/; max-age=34560000; samesite=lax; secure",
			stored: new Map(),
			reloads: 0,
			href: "https://shop.test/de/cart?step=2",
		});
	});

	it("keeps a new locale in localStorage with the localStorage strategy, then reloads", async () => {
		const visited = page("de");
		const { runtime } = await output({
			strategy: ["localStorage"],
			localStorageKey: "locale",
		});
		runtime.setLocale("ar");

		expect([visited.cookie, visited.stored, visited.reloads]).toEqual([
			"",
			new Map([["locale", "ar"]]),
			1,
		]);
	});

	it("writes the cookie by the config's policy, Secure on https and wherever the policy needs it", async () => {
		const cookieOf = async (href: string, config: Record<string, unknown>) => {
			const visited = page("de");
			visited.href = href;
			const { runtime } = await output({ strategy: ["cookie"], ...config });
			runtime.setLocale("ar", { reload: false });
			return visited.cookie;
		};

		expect([
			await cookieOf("http://shop.test/", { cookieName: "lang" }),
			await cookieOf("http://shop.test/", {
				cookieName: "lang",
				cookieMaxAge: 3600,
				cookieDomain: "shop.test",
				cookieSameSite: "strict",
			}),
			await cookieOf("http://shop.test/", {
				cookieName: "lang",
				cookieSameSite: "none",
			}),
			await cookieOf("http://shop.test/", { cookieName: "__Host-lang" }),
			await cookieOf("http://shop.test/", { cookieName: "__Secure-lang" }),
		]).toEqual([
			"lang=ar; path=/; max-age=34560000; samesite=lax",
			"lang=ar; path=/; max-age=3600; domain=shop.test; samesite=strict",
			"lang=ar; path=/; max-age=34560000; samesite=none; secure",
			"__Host-lang=ar; path=/; max-age=34560000; samesite=lax; secure",
			"__Secure-lang=ar; path=/; max-age=34560000; samesite=lax; secure",
		]);
	});

	it("renders a message in the page's locale alone, as a production page holds no other", async () => {
		page("de");
		const { m } = await output();

		expect(m.title?.({}, { locale: "de" })).toBe("Ihr Warenkorb");
		expect(thrown(() => m.title?.({}, { locale: "en" }))).toMatchObject({
			name: "GraiError",
			code: "locale-not-loaded",
			message:
				'A message was called in "en", but this page renders in "de" alone.',
		});
		expect(thrown(() => m.title?.({}, { locale: "fr" }))).toMatchObject({
			code: "locale-unknown",
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

it("localizes a home page without a trailing slash, as a framework would redirect to drop it", async () => {
	const { runtime } = await output({ strategy: ["url"] });

	expect([
		runtime.localizeHref("/", { locale: "de" }),
		runtime.localizeHref("/?step=2#total", { locale: "de" }),
		runtime.localizeHref("/de", { locale: "en" }),
		runtime.localizeHref("/cart/", { locale: "de" }),
	]).toEqual(["/de", "/de?step=2#total", "/", "/de/cart/"]);
});

it("localizes paths and URLs by their first segment under the url strategy, the base locale having none", async () => {
	const { runtime } = await output({ strategy: ["url"] });
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

it("leaves paths and URLs as they are without the url strategy, since no URL then names a locale", async () => {
	const { runtime } = await output({
		strategy: ["cookie"],
		cookieName: "lang",
	});
	runtime.setLocale("de", { reload: false });

	expect(runtime.localizeHref("/cart?step=2#total")).toBe("/cart?step=2#total");
	expect(runtime.localizeHref("/ar/cart", { locale: "en" })).toBe("/ar/cart");
	expect(String(runtime.deLocalizeUrl("https://shop.test/ar/cart"))).toBe(
		"https://shop.test/ar/cart",
	);
	expect(
		String(runtime.localizeUrl("https://shop.test/cart", { locale: "ar" })),
	).toBe("https://shop.test/cart");
	expect(runtime.extractLocaleFromUrl("https://shop.test/ar/x")).toBe("en");
});
