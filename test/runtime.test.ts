import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { type Messages, project, thrown } from "./project.ts";

const catalogs = {
	en: { title: "Your cart" },
	de: { title: "Ihr Warenkorb" },
	ar: { title: "سلتك" },
};

/** A project's output as a script or a page loads it: its messages and runtime. */
const output = (config: Record<string, unknown> = {}) =>
	project(catalogs, config).load();

/** What server.js gives a server to define its own strategies by, and the `Vary` they make. */
type ServerStrategies = {
	defineServerStrategy(
		name: string,
		strategy: {
			getLocale(
				request: Request,
			): string | undefined | Promise<string | undefined>;
			vary?: readonly string[];
		},
	): void;
	vary: string;
};

/** A project's output as a server loads it: its messages, runtime and middleware. */
async function served(config: Record<string, unknown> = {}) {
	const { dir, load } = project(catalogs, config);
	const { m, runtime } = await load();
	const server = await import(
		pathToFileURL(join(dir, "out", "server.js")).href
	);
	return {
		m,
		runtime,
		server: server as ServerStrategies,
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
	it("renders in a script in the base locale, then in the locale setLocale sets for the process", async () => {
		const { m, runtime } = await output();

		expect([m.title?.(), runtime.getLocale()]).toEqual(["Your cart", "en"]);
		runtime.setLocale("de", { reload: false });
		expect([m.title?.(), runtime.getLocale()]).toEqual(["Ihr Warenkorb", "de"]);
	});

	it("throws locale-unknown for a locale a project of one locale does not have, though each message holds one variant", async () => {
		const { m } = await project({ en: { title: "Your cart" } }).load();

		expect(m.title?.({}, { locale: "en" })).toBe("Your cart");
		expect(thrown(() => m.title?.({}, { locale: "de" }))).toMatchObject({
			code: "locale-unknown",
		});
	});

	it("throws locale-unbound in a server whose middleware binds each request, unless the call names its locale", async () => {
		const { m, runtime } = await served();

		for (const call of [
			() => m.title?.(),
			() => runtime.getLocale(),
			() => runtime.setLocale("de", { reload: false }),
		]) {
			expect(thrown(call)).toMatchObject({
				name: "GraiError",
				code: "locale-unbound",
				message: expect.stringMatching(
					/in a task the handler starts.+not in its pull\(\).+pass \{ locale \} to the message/,
				),
			});
		}
		expect(m.title?.({}, { locale: "de" })).toBe("Ihr Warenkorb");
	});
});

describe("the middleware", () => {
	const config = {
		strategy: ["cookie", "url"],
		cookieName: "lang",
	};
	const localeOf = async (
		m: Messages,
		middleware: Awaited<ReturnType<typeof served>>["middleware"],
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
		const { m, middleware } = await served(config);

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
		const { m, middleware } = await served({ strategy: ["preferredLanguage"] });

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
		{ m, runtime, middleware }: Awaited<ReturnType<typeof served>>,
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
		const { m, middleware } = await served({
			strategy: ["localStorage", "preferredLanguage"],
			localStorageKey: "locale",
		});

		expect(
			await localeOf(m, middleware, "/", { "accept-language": "de" }),
		).toEqual(["de", "Ihr Warenkorb"]);
	});

	it("reads the locale a query parameter names, matched as a preferred language is", async () => {
		const { m, middleware } = await served({
			strategy: ["query", "cookie"],
			queryParameter: "lng",
			cookieName: "lang",
		});
		const cookie = { cookie: "lang=ar" };

		expect(
			await Promise.all([
				localeOf(m, middleware, "/?lng=de-AT", cookie),
				localeOf(m, middleware, "/?lng=fr", cookie),
				localeOf(m, middleware, "/", cookie),
			]),
		).toEqual([
			["de", "Ihr Warenkorb"],
			["ar", "سلتك"],
			["ar", "سلتك"],
		]);
	});

	it("keeps each request's locale while requests interleave", async () => {
		const rendered = await interleaved(await served(config), [
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
		const rendered = await interleaved(await served(config), [
			{ cookie: "lang=de", switchTo: "ar" },
			{ cookie: "lang=en" },
		]);

		expect(rendered).toEqual([
			["Ihr Warenkorb", "سلتك"],
			["Your cart", "Your cart"],
		]);
	});

	it("lets setLocale change the locale for the rest of the request only", async () => {
		const { m, runtime, middleware } = await served(config);
		const title = () => new Response(m.title?.());
		const switched = await middleware(
			new Request("https://shop.test/"),
			async () => {
				runtime.setLocale("de");
				await Promise.resolve();
				return title();
			},
		);
		const next = await middleware(new Request("https://shop.test/"), title);

		expect([await switched.text(), await next.text()]).toEqual([
			"Ihr Warenkorb",
			"Your cart",
		]);
	});
});

describe("a body the handler streams", () => {
	const encoder = new TextEncoder();
	/** A turn of the event loop: what comes after it runs once the middleware has returned. */
	const later = () => new Promise((resolve) => setTimeout(resolve));
	/** The body of the middleware's response to a request for `/de/cart` that streams `body`. */
	const streamed = async (
		body: (m: Messages) => ReadableStream<Uint8Array>,
	) => {
		const { m, middleware } = await served({ strategy: ["url"] });
		const response = await middleware(
			new Request("https://shop.test/de/cart"),
			() => new Response(body(m)),
		);
		return response.text();
	};

	it("renders in the request's locale when its start() pushes it, after awaits, as SvelteKit's does", async () => {
		const text = await streamed(
			(m) =>
				new ReadableStream({
					async start(controller) {
						for (let line = 0; line < 4; line++) {
							await later();
							controller.enqueue(encoder.encode(`${m.title?.()}|`));
						}
						controller.close();
					},
				}),
		);

		expect(text).toBe("Ihr Warenkorb|".repeat(4));
	});

	it("renders in the request's locale when a task the handler started writes it", async () => {
		const text = await streamed((m) => {
			const { readable, writable } = new TransformStream<Uint8Array>();
			const writer = writable.getWriter();
			const write = async () => {
				for (let line = 0; line < 4; line++) {
					await later();
					await writer.write(encoder.encode(`${m.title?.()}|`));
				}
				await writer.close();
			};
			write();
			return readable;
		});

		expect(text).toBe("Ihr Warenkorb|".repeat(4));
	});

	it("fails with locale-unbound when its pull renders it, as the reader starts a pull once the middleware has returned", async () => {
		let lines = 0;
		const text = streamed(
			(m) =>
				new ReadableStream({
					pull(controller) {
						controller.enqueue(encoder.encode(`${m.title?.()}|`));
						if (++lines === 4) controller.close();
					},
				}),
		);

		await expect(text).rejects.toMatchObject({ code: "locale-unbound" });
	});
});

describe("the response's Vary", () => {
	/** The `Vary` of the response the middleware gives for `response`, by `strategy`. */
	const varyOf = async (
		strategy: string[],
		response = () => new Response("Your cart"),
	) => {
		const { middleware } = await served({
			strategy,
			...(strategy.includes("cookie") ? { cookieName: "lang" } : {}),
			...(strategy.includes("localStorage") ? { localStorageKey: "lang" } : {}),
			...(strategy.includes("query") ? { queryParameter: "lng" } : {}),
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
		[["query", "cookie"], "Cookie"],
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
		const { middleware } = await served({ strategy: ["preferredLanguage"] });
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
		middleware: Awaited<ReturnType<typeof served>>["middleware"],
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
		const { middleware } = await served(config);

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
		middleware: Awaited<ReturnType<typeof served>>["middleware"],
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
		const { middleware, runtime } = await served({
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
		const { middleware } = await served({
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

	it("leaves a path it leaves alone as it is in the URL helpers, though it starts as a prefix does", async () => {
		const { middleware, runtime } = await served({
			strategy: ["url", "cookie"],
			cookieName: "lang",
			localePrefix: "always",
			unlocalizedPaths: ["/de/api/**"],
		});

		expect([
			await answer(middleware, "/de/api/data", "lang=ar"),
			String(runtime.deLocalizeUrl("https://shop.test/de/api/data")),
			runtime.localizeHref("/de/api/data", { locale: "en" }),
			runtime.localizeHref("/de/cart", { locale: "en" }),
		]).toEqual([
			[200, "ar"],
			"https://shop.test/de/api/data",
			"/de/api/data",
			"/en/cart",
		]);
	});
});

it("reads and writes a locale's own prefix, where the config gives one", async () => {
	const { runtime, middleware } = await served({
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

it("links to a page in its locale's words, and reads them back as the app's route", async () => {
	const { runtime } = await output({
		strategy: ["url"],
		pathnames: {
			"/about": { de: "/ueber-uns", ar: "/عن" },
			"/products/[id]": { de: "/produkte/[id]" },
		},
	});
	const routeOf = (url: string) => runtime.deLocalizeUrl(url).pathname;

	expect([
		runtime.localizeHref("/about", { locale: "de" }),
		runtime.localizeHref("/products/7?view=all", { locale: "de" }),
		runtime.localizeHref("/cart", { locale: "de" }),
		runtime.localizeHref("/de/ueber-uns", { locale: "ar" }),
		runtime.localizeHref("/de/produkte/7", { locale: "en" }),
		routeOf("https://shop.test/de/produkte/7"),
		routeOf("https://shop.test/ar/%D8%B9%D9%86"),
		routeOf("https://shop.test/de/cart"),
	]).toEqual([
		"/de/ueber-uns",
		"/de/produkte/7?view=all",
		"/de/cart",
		"/ar/%D8%B9%D9%86",
		"/products/7",
		"/products/7",
		"/about",
		"/cart",
	]);
});

it("keeps a path's trailing slash through its words, as a framework that writes pages into folders links them", async () => {
	const { runtime } = await output({
		strategy: ["url"],
		pathnames: {
			"/about": { de: "/ueber-uns" },
			"/products/[id]": { de: "/produkte/[id]" },
		},
	});

	expect([
		runtime.localizeHref("/about/", { locale: "de" }),
		runtime.localizeHref("/products/7/?view=all", { locale: "de" }),
		runtime.localizeHref("/de/ueber-uns/", { locale: "en" }),
		runtime.deLocalizeUrl("https://shop.test/de/produkte/7/").pathname,
		runtime.localizeHref("/", { locale: "de" }),
	]).toEqual([
		"/de/ueber-uns/",
		"/de/produkte/7/?view=all",
		"/about/",
		"/products/7/",
		"/de",
	]);
});

it("translates the base locale's paths too, and sends an unprefixed page to its locale's words", async () => {
	const config = {
		strategy: ["url", "cookie"],
		cookieName: "lang",
		localePrefix: "always",
		pathnames: { "/about": { en: "/about-us", de: "/ueber-uns" } },
	};
	const { runtime } = await output(config);
	const { middleware } = await served(config);
	const response = await middleware(
		new Request("https://shop.test/about", { headers: { cookie: "lang=de" } }),
		() => new Response("page"),
	);

	expect([
		runtime.localizeHref("/about", { locale: "en" }),
		runtime.deLocalizeUrl("https://shop.test/en/about-us").pathname,
		response.headers.get("location"),
	]).toEqual(["/en/about-us", "/about", "https://shop.test/de/ueber-uns"]);
});

it("puts the locale after the app's base path, and reads it there", async () => {
	const config = {
		strategy: ["url"],
		basePath: "/shop",
		pathnames: { "/about": { de: "/ueber-uns" } },
	};
	const { runtime } = await output(config);
	const { middleware } = await served(config);
	const localeAt = async (path: string) =>
		(
			await middleware(
				new Request(`https://example.test${path}`),
				({ locale }) => new Response(locale),
			)
		).text();

	expect([
		runtime.localizeHref("/shop/about", { locale: "de" }),
		runtime.localizeHref("/shop", { locale: "de" }),
		runtime.localizeHref("/shop/de/ueber-uns", { locale: "en" }),
		runtime.deLocalizeUrl("https://example.test/shop/de/ueber-uns").pathname,
		runtime.extractLocaleFromUrl("https://example.test/shop/ar/x"),
		await localeAt("/shop/de/cart"),
		await localeAt("/shop/cart"),
	]).toEqual([
		"/shop/de/ueber-uns",
		"/shop/de",
		"/shop/about",
		"/shop/about",
		"ar",
		"de",
		"en",
	]);
});

it("reads a relative href from the request's URL, as SvelteKit's resolve() writes a link under a relative base", async () => {
	const { runtime, middleware } = await served({
		strategy: ["url"],
		basePath: "/shop",
		pathnames: { "/about": { de: "/ueber-uns" } },
	});
	const links = async (path: string, ...hrefs: [string, string?][]) =>
		(
			await middleware(new Request(`https://example.test${path}`), () => {
				const localized = hrefs.map(([href, locale]) =>
					runtime.localizeHref(href, locale === undefined ? {} : { locale }),
				);
				return new Response(localized.join(" "));
			})
		).text();

	expect(
		await links("/shop/de", ["./about"], ["./about", "en"], ["./", "ar"]),
	).toBe("/shop/de/ueber-uns /shop/about /shop/ar");
	expect(
		await links(
			"/shop/de/products/7",
			["../../about"],
			["?view=all", "en"],
			["#reviews"],
		),
	).toBe(
		"/shop/de/ueber-uns /shop/products/7?view=all /shop/de/products/7#reviews",
	);
	// Outside a page and a request, the runtime knows nothing a relative href is relative to.
	expect([
		runtime.localizeHref("./about", { locale: "de" }),
		runtime.localizeHref("mailto:shop@example.test"),
		runtime.localizeHref("//cdn.example.test/logo.svg"),
	]).toEqual([
		"./about",
		"mailto:shop@example.test",
		"//cdn.example.test/logo.svg",
	]);
});

it("takes a path without the base path as the app's own, as a framework that adds the base itself writes it", async () => {
	const { runtime } = await output({ strategy: ["url"], basePath: "/shop" });

	expect([
		runtime.localizeHref("/about", { locale: "de" }),
		runtime.deLocalizeUrl("https://example.test/de/about").pathname,
		runtime.extractLocaleFromUrl("https://example.test/de/about"),
	]).toEqual(["/de/about", "/about", "de"]);
});

it("sends an unprefixed page under the base path to its locale's path there", async () => {
	const { middleware } = await served({
		strategy: ["url", "cookie"],
		cookieName: "lang",
		localePrefix: "always",
		basePath: "/shop",
		unlocalizedPaths: ["/api/**"],
	});
	const answer = async (path: string) => {
		const response = await middleware(
			new Request(`https://example.test${path}`, {
				headers: { cookie: "lang=de" },
			}),
			({ locale }) => new Response(locale),
		);
		return response.headers.get("location") ?? (await response.text());
	};

	expect([
		await answer("/shop/cart"),
		await answer("/shop/api/orders"),
	]).toEqual(["https://example.test/shop/de/cart", "de"]);
});

describe("with a strategy the server defines", () => {
	const config = { strategy: ["custom-session", "cookie"], cookieName: "lang" };

	it("asks the server's strategy for a request's locale in the strategy's order, and goes on when it names none", async () => {
		const { middleware, server } = await served(config);
		server.defineServerStrategy("custom-session", {
			getLocale: async (request) =>
				request.headers.get("x-user-locale") ?? undefined,
			vary: ["X-User-Locale"],
		});
		const answer = (headers: Record<string, string>) =>
			middleware(
				new Request("https://shop.test/", { headers }),
				({ locale }) => new Response(locale),
			);
		const byServer = await answer({ "x-user-locale": "de", cookie: "lang=ar" });
		const byCookie = await answer({ cookie: "lang=ar" });

		expect([
			await byServer.text(),
			await byCookie.text(),
			byServer.headers.get("vary"),
			server.vary,
		]).toEqual(["de", "ar", "X-User-Locale, Cookie", "X-User-Locale, Cookie"]);
	});

	it("refuses a request no definition answers, a definition the strategy does not list, and a locale the project lacks", async () => {
		const { middleware, server } = await served(config);
		const request = () =>
			middleware(
				new Request("https://shop.test/"),
				() => new Response(""),
			).catch((error: unknown) => error);

		expect(await request()).toMatchObject({
			code: "strategy-undefined",
			message:
				'"strategy" lists "custom-session", which no defineServerStrategy("custom-session", { getLocale }) on this server defines. Define it before the first request.',
		});
		expect(
			thrown(() =>
				server.defineServerStrategy("custom-user", { getLocale: () => "de" }),
			),
		).toMatchObject({
			code: "strategy-undefined",
			message:
				'"custom-user" is not in the config\'s "strategy": ["custom-session","cookie"]. Name the strategy there, then define it.',
		});
		server.defineServerStrategy("custom-session", { getLocale: () => "fr" });
		expect(await request()).toMatchObject({ code: "locale-unknown" });
	});
});

describe("with a domain per locale", () => {
	const config = {
		strategy: ["url"],
		domains: { en: "shop.test", de: "shop.de.test", ar: "shop.ar.test" },
		pathnames: { "/about": { de: "/ueber-uns" } },
	};

	it("takes the locale a request's host is the domain of, and links across hosts with whole URLs", async () => {
		const { runtime, middleware } = await served(config);
		const answer = async (url: string, href: string, locale: string) =>
			(
				await middleware(
					new Request(url),
					({ locale: found }) =>
						new Response(`${found} ${runtime.localizeHref(href, { locale })}`),
				)
			).text();

		expect([
			await answer("https://shop.de.test/cart", "/about", "de"),
			await answer("https://shop.de.test/cart", "/about", "ar"),
			await answer("https://shop.test/cart", "/about", "de"),
		]).toEqual([
			"de /ueber-uns",
			"de https://shop.ar.test/about",
			"en https://shop.de.test/ueber-uns",
		]);
		expect([
			String(runtime.localizeUrl("https://shop.test/cart", { locale: "de" })),
			runtime.deLocalizeUrl("https://shop.de.test/ueber-uns").pathname,
			runtime.extractLocaleFromUrl("https://shop.ar.test/x"),
		]).toEqual(["https://shop.de.test/cart", "/about", "ar"]);
	});

	it("routes by prefix on a host that is no locale's, as in development", async () => {
		const { runtime, middleware } = await served(config);
		const answer = async (url: string) =>
			(
				await middleware(
					new Request(url),
					({ locale }) =>
						new Response(
							`${locale} ${runtime.localizeHref("/about", { locale: "de" })}`,
						),
				)
			).text();

		expect([
			await answer("http://localhost:5173/de/cart"),
			await answer("http://localhost:5173/cart"),
		]).toEqual(["de /de/ueber-uns", "en /de/ueber-uns"]);
	});
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
				get baseURI() {
					return visited.href;
				},
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

	it("reads a relative href from the page's URL", async () => {
		page("de");
		const { runtime } = await output({
			strategy: ["url"],
			pathnames: { "/about": { de: "/ueber-uns" } },
		});

		expect([
			runtime.localizeHref("./about"),
			runtime.localizeHref("?step=3", { locale: "ar" }),
			runtime.localizeHref(""),
		]).toEqual(["/de/ueber-uns", "/ar/cart?step=3", "/de/cart?step=2"]);
	});

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

	it("keeps the choice with setLocale and { reload: false }, and leaves the page in its locale", async () => {
		const visited = page("de");
		const { m, runtime } = await output({
			strategy: ["cookie"],
			cookieName: "lang",
		});
		runtime.setLocale("ar", { reload: false });

		expect([runtime.getLocale(), m.title?.(), visited.reloads]).toEqual([
			"de",
			"Ihr Warenkorb",
			0,
		]);
		expect(visited.cookie).toBe(
			"lang=ar; path=/; max-age=34560000; samesite=lax; secure",
		);
	});

	it("refuses setLocale where the strategy keeps the choice nowhere, which the reload would lose, but for the page's own locale", async () => {
		const visited = page("de");
		const { runtime } = await output({ strategy: ["preferredLanguage"] });

		expect(thrown(() => runtime.setLocale("ar"))).toMatchObject({
			name: "GraiError",
			code: "locale-unkept",
		});
		expect(
			thrown(() => runtime.setLocale("ar", { reload: false })),
		).toMatchObject({
			code: "locale-unkept",
		});
		runtime.setLocale("de");
		expect([runtime.getLocale(), visited.reloads]).toEqual(["de", 0]);
	});

	it("refuses setLocale where only the server's own strategy keeps the choice, which a page cannot write", async () => {
		page("de");
		const { runtime } = await output({ strategy: ["custom-session"] });

		expect(thrown(() => runtime.setLocale("ar"))).toMatchObject({
			code: "locale-unkept",
		});
	});

	it("names the new locale in the URL's query parameter with the query strategy", async () => {
		const visited = page("de");
		const { runtime } = await output({
			strategy: ["query"],
			queryParameter: "lng",
		});
		runtime.setLocale("ar");

		expect(visited.href).toBe("https://shop.test/de/cart?step=2&lng=ar");
		expect(visited.reloads).toBe(0);
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
