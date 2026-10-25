import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UnderlyingSource } from "node:stream/web";
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

describe("a body the handler streams", () => {
	const encoder = new TextEncoder();
	/**
	 * A body that renders the title on each pull, `chunks` times. Its pulls are synchronous, so the
	 * reads after the first one start them, in the reader's context.
	 */
	const titles = (
		m: Messages,
		chunks: number,
		source: UnderlyingSource<Uint8Array> = {},
	) => {
		let sent = 0;
		return new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(encoder.encode(`${m.title?.()}|`));
				if (++sent === chunks) controller.close();
			},
			...source,
		});
	};
	/** The middleware's response to a request for `/de/cart`, whose handler returns `body`. */
	const streamed = async (
		body: (m: Messages) => ReadableStream<Uint8Array>,
	) => {
		const { m, middleware } = await output({ strategy: ["url"] });
		return middleware(
			new Request("https://shop.test/de/cart"),
			() => new Response(body(m)),
		);
	};

	it("renders every chunk in the request's locale, pulled after the middleware returns", async () => {
		const response = await streamed((m) => titles(m, 4));

		expect(await response.text()).toBe("Ihr Warenkorb|".repeat(4));
	});

	it("is pulled only as the response's body is read", async () => {
		let pulls = 0;
		const response = await streamed((m) =>
			titles(m, 4, {
				pull(controller) {
					pulls++;
					controller.enqueue(encoder.encode(`${m.title?.()}|`));
				},
			}),
		);
		const before = pulls;
		await response.body?.getReader().read();

		expect([before, pulls]).toEqual([1, 2]);
	});

	it("passes its error on to the response's body", async () => {
		const failure = new Error("the page failed to render");
		const response = await streamed((m) =>
			titles(m, 4, {
				pull() {
					throw failure;
				},
			}),
		);

		await expect(response.text()).rejects.toBe(failure);
	});

	it("is cancelled in the request's locale when the response's body is", async () => {
		const cancelled: unknown[] = [];
		const response = await streamed((m) =>
			titles(m, 4, {
				cancel(reason) {
					cancelled.push(reason, m.title?.());
				},
			}),
		);
		await response.body?.cancel("the reader left");

		expect(cancelled).toEqual(["the reader left", "Ihr Warenkorb"]);
	});

	it("is passed on as it is when it comes from fetch(), as no app code renders it", async () => {
		const { middleware } = await output({ strategy: ["url"] });
		const fetched = await fetch("data:text/plain,Ihr%20Warenkorb");
		const response = await middleware(
			new Request("https://shop.test/de/cart"),
			() => fetched,
		);

		expect(response.body).toBe(fetched.body);
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
