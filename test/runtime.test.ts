import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
