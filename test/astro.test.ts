import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type DocumentStart,
	rewriteDocumentStart,
} from "../src/astro/document.ts";
import {
	type LocaleContext,
	type LocaleProject,
	localeMiddleware,
} from "../src/astro/middleware.ts";
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
	const server = await outputServer(dir);
	return {
		m,
		middleware: (project: Partial<LocaleProject> = {}) =>
			localeMiddleware({
				middleware: server.middleware,
				getTextDirection: runtime.getTextDirection,
				configName: "grai.config.json",
				requestStrategies: [],
				...project,
			}),
	};
}

async function outputServer(
	dir: string,
): Promise<{ middleware: LocaleProject["middleware"] }> {
	return import(pathToFileURL(join(dir, "out", "server.js")).href);
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

	it("passes on anything but a page as it is", async () => {
		const { middleware } = await compiledProject({ strategy: ["url"] });
		const json = Response.json({ title: "Your cart" });

		expect(
			await middleware()(context("/ro/cart.json"), () => Promise.resolve(json)),
		).toBe(json);
	});

	it("fails a prerendered page whose locale the strategy finds in each request", async () => {
		const { m, middleware } = await compiledProject({
			strategy: ["cookie", "url"],
			cookieName: "lang",
		});
		const onRequest = middleware({ requestStrategies: ["cookie"] });

		const error = await onRequest(
			context("/about", {}, { isPrerendered: true, routePattern: "/about" }),
			page(m),
		).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			name: "GraiError",
			code: "config-invalid",
			message: `grai.config.json: the page /about is prerendered, but "strategy" finds the locale in the request (by "cookie"), which a prerendered page does not have: it would show every reader the one locale it was built in. Render the page on demand (export const prerender = false), or find the locale in the URL alone ("strategy": ["url"]).`,
		});
	});
});
