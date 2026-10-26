import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type AstroRouting, disagreements } from "../src/astro/agreement.ts";
import {
	type DocumentStart,
	rewriteDocumentStart,
} from "../src/astro/document.ts";
import {
	type LocaleContext,
	type LocaleProject,
	localeMiddleware,
} from "../src/astro/middleware.ts";
import { readConfig } from "../src/config.ts";
import { type Messages, project } from "./project.ts";

const start: DocumentStart = {
	lang: "ar",
	dir: "rtl",
	head: '<script type="importmap">{}</script>',
};

/** A body streamed in the given chunks, rewritten, as a response to read it back whole. */
function rewrittenBody(chunks: readonly (string | Uint8Array)[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(
					typeof chunk === "string" ? encoder.encode(chunk) : chunk,
				);
			}
			controller.close();
		},
	});
	return new Response(rewriteDocumentStart(body, start));
}

const rewritten = (chunks: readonly (string | Uint8Array)[]) =>
	rewrittenBody(chunks).text();

describe("the document's start", () => {
	it("gets the page's lang and dir, keeps the tag's other attributes, and opens the head with the given script", async () => {
		const page = `<!DOCTYPE html><html class="dark" LANG="en" data-note='a > b' dir=ltr hidden><head><meta charset="utf-8"></head><body>Hi</body></html>`;

		expect(await rewritten([page])).toBe(
			`<!DOCTYPE html><html class="dark" data-note='a > b' hidden lang="ar" dir="rtl"><head><script type="importmap">{}</script><meta charset="utf-8"></head><body>Hi</body></html>`,
		);
	});

	it("reads a start cut anywhere, a character of several bytes included", async () => {
		const page = `<!DOCTYPE html>\n<!-- a page -->\n<html data-title="Bună ziua" lang="ro">\n<head>\n<title>Bună</title></head></html>`;
		const bytes = new TextEncoder().encode(page);
		const oneByOne = Array.from(bytes, (byte) => Uint8Array.of(byte));

		expect(await rewritten(oneByOne)).toBe(await rewritten([page]));
		expect(await rewritten([page])).toBe(
			`<!DOCTYPE html>\n<!-- a page -->\n<html data-title="Bună ziua" lang="ar" dir="rtl">\n<head><script type="importmap">{}</script>\n<title>Bună</title></head></html>`,
		);
	});

	it("passes on what follows the start as it comes, before the page has ended", async () => {
		const encoder = new TextEncoder();
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const body = new ReadableStream<Uint8Array>({
			start(opened) {
				controller = opened;
			},
		});
		const reader = rewriteDocumentStart(body, start).getReader();
		const decoder = new TextDecoder();

		controller?.enqueue(encoder.encode("<!doctype html><html><head><title>"));
		const first = await reader.read();
		controller?.enqueue(encoder.encode("Shop</title>"));
		const second = await reader.read();

		expect(decoder.decode(first.value)).toBe(
			`<!doctype html><html lang="ar" dir="rtl"><head><script type="importmap">{}</script>`,
		);
		expect(decoder.decode(second.value)).toBe("<title>");
	});

	it("reads past comments before the doctype, such as a license", async () => {
		expect(
			await rewritten([
				"<!-- license -->\n<!doctype html><html><head><title>Shop</title></head>",
			]),
		).toBe(
			`<!-- license -->\n<!doctype html><html lang="ar" dir="rtl"><head><script type="importmap">{}</script><title>Shop</title></head>`,
		);
	});

	it("writes the <html> and <head> start tags a document leaves out", async () => {
		expect(await rewritten(["<!DOCTYPE html><title>Shop</title>"])).toBe(
			`<!DOCTYPE html><html lang="ar" dir="rtl"><script type="importmap">{}</script><title>Shop</title>`,
		);
		expect(
			await rewritten(["<!DOCTYPE html><html><body>Shop</body></html>"]),
		).toBe(
			`<!DOCTYPE html><html lang="ar" dir="rtl"><script type="importmap">{}</script><body>Shop</body></html>`,
		);
	});

	it("passes a body that is no document as it is: a partial, or bytes that are not UTF-8", async () => {
		const partial = `<li lang="en">Shop</li>`;
		expect(await rewritten([partial])).toBe(partial);

		const encoded = (text: string) => new TextEncoder().encode(text);
		const latin1 = Uint8Array.of(
			...encoded('<!DOCTYPE html><html data-name="Ren'),
			0xe9,
			...encoded('"><head><title>'),
		);
		expect(await rewrittenBody([latin1]).bytes()).toEqual(latin1);
	});
});

/** A project's config, read as the integration reads it. */
function graiConfig(config: Record<string, unknown>) {
	return readConfig(
		project({ en: { title: "Cart" }, ro: { title: "Coș" } }, config).config,
	);
}

/** Astro's i18n routing as its config resolves it: the default locale without a prefix. */
const unprefixed: Exclude<
	NonNullable<AstroRouting["i18n"]>["routing"],
	"manual"
> = {
	prefixDefaultLocale: false,
	redirectToDefaultLocale: false,
	fallbackType: "redirect",
};

/** Astro's i18n routing of `locales`, the default `en`, with `routing` and anything else given. */
function astroRouting(
	locales: NonNullable<AstroRouting["i18n"]>["locales"],
	more: Partial<NonNullable<AstroRouting["i18n"]>> = {},
): AstroRouting {
	return {
		base: "/",
		i18n: { locales, defaultLocale: "en", routing: unprefixed, ...more },
		image: { endpoint: { route: "/_image" } },
	};
}

const prefixed = { ...unprefixed, prefixDefaultLocale: true };

describe("grai's config beside Astro's", () => {
	it("agrees with Astro's i18n routing by the same locales and default, the URL read first", () => {
		expect(
			disagreements(
				graiConfig({ strategy: ["url"] }),
				astroRouting(["ro", "en"]),
			),
		).toEqual([]);
	});

	it("agrees with any base, and no i18n routing, when the locale is not in the URL", () => {
		expect(
			disagreements(graiConfig({ strategy: ["cookie"], cookieName: "lang" }), {
				base: "/shop",
				image: { endpoint: { route: "/_image" } },
			}),
		).toEqual([]);
	});

	it('maps Astro\'s prefixed default locale to "localePrefix": "always", and says which to set', () => {
		const always = graiConfig({
			strategy: ["url"],
			localePrefix: "always",
			unlocalizedPaths: ["/_image", "/_server-islands/**", "/404", "/500"],
		});
		const asNeeded = graiConfig({ strategy: ["url"] });

		expect(
			disagreements(always, astroRouting(["en", "ro"], { routing: prefixed })),
		).toEqual([]);
		expect(
			disagreements(
				asNeeded,
				astroRouting(["en", "ro"], { routing: prefixed }),
			),
		).toEqual([
			`Astro prefixes the default locale's URLs too (i18n.routing.prefixDefaultLocale). Set "localePrefix": "always" in grai's config.`,
		]);
		expect(disagreements(always, astroRouting(["en", "ro"]))).toEqual([
			`grai prefixes every locale's URLs ("localePrefix": "always"). Set Astro's i18n.routing.prefixDefaultLocale to true.`,
		]);
	});

	it('leaves Astro\'s own routes alone under "localePrefix": "always", and says which paths to set', () => {
		expect(
			disagreements(
				graiConfig({
					strategy: ["url"],
					localePrefix: "always",
					unlocalizedPaths: ["/api/**", "/404"],
				}),
				astroRouting(["en", "ro"], { routing: prefixed }),
			),
		).toEqual([
			`With "localePrefix": "always", grai sends a request without a locale prefix to its locale's path, and Astro's own /_image, /_server-islands/**, /500 have none. Set "unlocalizedPaths": ["/api/**","/404","/_image","/_server-islands/**","/500"] in grai's config.`,
		]);
	});

	it('maps Astro\'s { path, codes } locales to "localePrefixes", and says which to set', () => {
		const romana = [
			"en",
			{ path: "romana", codes: ["ro", "ro-MD"] },
		] satisfies NonNullable<AstroRouting["i18n"]>["locales"];
		const withPrefix = graiConfig({
			strategy: ["url"],
			localePrefixes: { ro: "romana" },
		});

		expect(disagreements(withPrefix, astroRouting(romana))).toEqual([]);
		expect(
			disagreements(graiConfig({ strategy: ["url"] }), astroRouting(romana)),
		).toEqual([
			`Astro serves ro under /romana/, and grai under /ro/. Set "localePrefixes": { "ro": "romana" } in grai's config.`,
		]);
		expect(disagreements(withPrefix, astroRouting(["en", "ro"]))).toEqual([
			`grai serves ro under /romana/ ("localePrefixes"), and Astro under /ro/. List it in Astro's i18n.locales as { path: "romana", codes: ["ro"] }.`,
		]);
	});

	it("has a regional locale, which Astro's links lowercase, written as its path and prefix", () => {
		const regional = (config: Record<string, unknown>) =>
			readConfig(
				project(
					{ en: { title: "Cart" }, "pt-BR": { title: "Carrinho" } },
					config,
				).config,
			);

		expect(
			disagreements(
				regional({ strategy: ["url"] }),
				astroRouting(["en", "pt-BR"]),
			),
		).toEqual([
			`Astro links pt-BR's pages under /pt-br/, its tag lowercased, where the "url" strategy reads /pt-BR/. List it in Astro's i18n.locales as { path: "pt-br", codes: ["pt-BR"] }, and set "localePrefixes": { "pt-BR": "pt-br" } in grai's config.`,
		]);
		expect(
			disagreements(
				regional({ strategy: ["url"], localePrefixes: { "pt-BR": "pt-br" } }),
				astroRouting(["en", { path: "pt-br", codes: ["pt-BR"] }]),
			),
		).toEqual([]);
	});

	it('maps the paths outside Astro\'s routing to "unlocalizedPaths", whose locale the strategies after "url" find', () => {
		expect(
			disagreements(
				graiConfig({
					strategy: ["url", "cookie"],
					cookieName: "lang",
					unlocalizedPaths: ["/account/**"],
				}),
				astroRouting(["en", "ro"]),
			),
		).toEqual([]);
	});

	it('reads the URL first beside Astro\'s routing, and says how to order "strategy"', () => {
		expect(
			disagreements(
				graiConfig({ strategy: ["cookie", "url"], cookieName: "lang" }),
				astroRouting(["en", "ro"]),
			),
		).toEqual([
			`Astro's i18n routing renders each page in the locale its URL names, so "url" must come first in "strategy": ["url","cookie"], not ["cookie","url"].`,
		]);
	});

	it("has Astro's i18n routing route grai's locales", () => {
		expect(
			disagreements(
				graiConfig({ strategy: ["url"] }),
				astroRouting(["en", "ru"]),
			),
		).toEqual([
			`Astro's i18n.locales must route grai's "locales", ["en","ro"], not ["en","ru"].`,
		]);
	});

	it("has Astro's default locale be grai's base locale, by its path when it has one", () => {
		const config = graiConfig({ strategy: ["url"] });

		expect(
			disagreements(
				config,
				astroRouting(["en", "ro"], { defaultLocale: "ro" }),
			),
		).toEqual([
			`Astro's i18n.defaultLocale must be "en", grai's "baseLocale", not "ro".`,
		]);
		expect(
			disagreements(
				config,
				astroRouting([{ path: "english", codes: ["en"] }, "ro"], {
					defaultLocale: "ro",
				}),
			),
		).toEqual([
			`Astro's i18n.defaultLocale must be "english", grai's "baseLocale", not "ro".`,
		]);
	});

	it("refuses a base and domains, which the url strategy cannot read yet, saying what to set", () => {
		expect(
			disagreements(graiConfig({ strategy: ["url"] }), {
				...astroRouting(["en", "ro"], {
					domains: { ro: "https://example.ro" },
				}),
				base: "/shop/",
			}),
		).toEqual([
			`The "url" strategy reads the locale from the path's first segment, which Astro's base "/shop/" takes. Serve the site from Astro's base "/" ("The framework's base path" in grai's docs/followups.md).`,
			`Astro's i18n.domains serves ro from domains of their own, where grai's "url" strategy finds the locale in the path. Remove i18n.domains and serve each locale under its path prefix ("A domain per locale" in grai's docs/followups.md).`,
		]);
	});
});

/** A project compiled with `config`, its messages and the middleware its output gives Astro. */
async function compiledProject(config: Record<string, unknown>) {
	const { dir, load } = project(
		{
			en: { title: "Your cart" },
			ro: { title: "Coșul tău" },
			ar: { title: "سلتك" },
		},
		config,
	);
	const { m, runtime } = await load();
	const server = await outputModule<Pick<LocaleProject, "middleware">>(
		dir,
		"server.js",
	);
	const internal = await outputModule<Pick<LocaleProject, "localeOfPath">>(
		dir,
		"internal.js",
	);
	return {
		m,
		middleware: (project: Partial<LocaleProject> = {}) =>
			localeMiddleware({
				middleware: server.middleware,
				getTextDirection: runtime.getTextDirection,
				localeOfPath: internal.localeOfPath,
				configName: "grai.config.json",
				requestStrategies: { beforeUrl: [], afterUrl: [] },
				...project,
			}),
	};
}

/** A module of a project's output, by its name, as the middleware's code imports it. */
async function outputModule<Module>(
	dir: string,
	file: string,
): Promise<Module> {
	return import(pathToFileURL(join(dir, "out", file)).href);
}

/** What the middleware reads of Astro's context, for a request to `path`. */
function context(
	path: string,
	headers: Record<string, string> = {},
	rest: Partial<LocaleContext> = {},
): LocaleContext {
	return {
		request: new Request(`https://shop.test${path}`, { headers }),
		isPrerendered: false,
		routePattern: "/[...locale]",
		csp: undefined,
		...rest,
	};
}

/** A page Astro renders: its document, with the cart's title in its body. */
const page = (m: Messages) => () =>
	Promise.resolve(
		new Response(
			`<!DOCTYPE html><html lang="en"><head></head><body>${m.title?.()}</body></html>`,
			{ headers: { "content-type": "text/html", "content-length": "1" } },
		),
	);

describe("the middleware", () => {
	it("renders a page in the locale the strategy finds, and writes it with its direction to <html>", async () => {
		const { m, middleware } = await compiledProject({
			strategy: ["cookie", "preferredLanguage"],
			cookieName: "lang",
		});
		const onRequest = middleware();

		const byCookie = await onRequest(
			context("/", { cookie: "lang=ro", "accept-language": "ar" }),
			page(m),
		);
		const byLanguage = await onRequest(
			context("/", { "accept-language": "ar-EG, en;q=0.5" }),
			page(m),
		);

		expect(await byCookie.text()).toBe(
			`<!DOCTYPE html><html lang="ro" dir="ltr"><head></head><body>Coșul tău</body></html>`,
		);
		expect(await byLanguage.text()).toBe(
			`<!DOCTYPE html><html lang="ar" dir="rtl"><head></head><body>سلتك</body></html>`,
		);
		expect(byLanguage.headers.get("content-length")).toBe(null);
	});

	it("renders requests that interleave each in its own locale", async () => {
		const { m, middleware } = await compiledProject({ strategy: ["url"] });
		const onRequest = middleware();
		let started: () => void = () => {};
		const secondStarted = new Promise<void>((resolve) => {
			started = resolve;
		});

		const [first, second] = await Promise.all([
			onRequest(context("/ro/"), async () => {
				await secondStarted;
				return page(m)();
			}),
			onRequest(context("/ar/"), () => {
				started();
				return page(m)();
			}),
		]);

		expect([await first.text(), await second.text()]).toEqual([
			`<!DOCTYPE html><html lang="ro" dir="ltr"><head></head><body>Coșul tău</body></html>`,
			`<!DOCTYPE html><html lang="ar" dir="rtl"><head></head><body>سلتك</body></html>`,
		]);
	});

	it("opens a built page's head with its locale's import map, and lets a CSP allow it", async () => {
		const { m, middleware } = await compiledProject({ strategy: ["url"] });
		const onRequest = middleware({
			importMaps: {
				ro: { script: "<script>ro</script>", hash: "sha256-ro" },
				en: { script: "<script>en</script>", hash: "sha256-en" },
			},
		});
		const allowed: unknown[] = [];

		const response = await onRequest(
			context(
				"/ro/",
				{},
				{
					csp: { insertScriptHash: (hash) => allowed.push(hash) },
				},
			),
			page(m),
		);

		expect(await response.text()).toBe(
			`<!DOCTYPE html><html lang="ro" dir="ltr"><head><script>ro</script></head><body>Coșul tău</body></html>`,
		);
		expect(allowed).toEqual(["sha256-ro"]);
	});

	it("passes on anything but a page as it is", async () => {
		const { middleware } = await compiledProject({ strategy: ["url"] });
		const json = Response.json({ title: "Your cart" });

		expect(
			await middleware()(context("/ro/cart.json"), () => Promise.resolve(json)),
		).toBe(json);
	});

	/** What a prerendered page at `path` gives: its response, or what it threw. */
	const prerendering = (
		onRequest: ReturnType<typeof localeMiddleware>,
		m: Messages,
		path: string,
	) =>
		onRequest(
			context(path, {}, { isPrerendered: true, routePattern: path }),
			page(m),
		).catch((thrown: unknown) => thrown);

	it("fails a prerendered page whose URL names its locale as a file, as Astro's file builds write it", async () => {
		for (const localePrefix of ["as-needed", "always"]) {
			const { m, middleware } = await compiledProject({
				strategy: ["url"],
				localePrefix,
				unlocalizedPaths: ["/404"],
			});
			const onRequest = middleware();

			expect(await prerendering(onRequest, m, "/ro.html")).toMatchObject({
				name: "GraiError",
				code: "config-invalid",
				message: `grai.config.json: the page /ro.html is prerendered at /ro.html, which names its locale as a file, ro.html, where the "url" strategy reads a path's first segment. Build each page into a folder: set Astro's build.format to "directory", and name a locale's page [locale]/index.astro rather than [locale].astro.`,
			});
			expect(await prerendering(onRequest, m, "/ro/about.html")).toBeInstanceOf(
				Response,
			);
		}
	});

	it("fails a prerendered page whose locale a strategy ahead of the URL would find in the request", async () => {
		const { m, middleware } = await compiledProject({
			strategy: ["cookie", "url"],
			cookieName: "lang",
		});
		const onRequest = middleware({
			requestStrategies: { beforeUrl: ["cookie"], afterUrl: [] },
		});

		expect(await prerendering(onRequest, m, "/ro/about")).toMatchObject({
			name: "GraiError",
			code: "config-invalid",
			message: `grai.config.json: the page /ro/about is prerendered, but "strategy" finds its locale in the request (by "cookie"), which a prerendered page does not have: it would show every reader the one locale it was built in. Render the page on demand (export const prerender = false), or have its URL name its locale, with "url" first in "strategy".`,
		});
	});

	it("prerenders a page whose URL names its locale, and fails one whose path names none, under a strategy after the URL", async () => {
		const { m, middleware } = await compiledProject({
			strategy: ["url", "cookie"],
			cookieName: "lang",
			unlocalizedPaths: ["/account/**"],
		});
		const onRequest = middleware({
			requestStrategies: { beforeUrl: [], afterUrl: ["cookie"] },
		});

		expect(await prerendering(onRequest, m, "/ro/about")).toBeInstanceOf(
			Response,
		);
		expect(await prerendering(onRequest, m, "/account/orders")).toMatchObject({
			name: "GraiError",
			message: expect.stringContaining(
				'the page /account/orders is prerendered, but "strategy" finds its locale in the request (by "cookie")',
			),
		});
	});
});
