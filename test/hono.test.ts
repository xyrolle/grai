import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { project } from "./project.ts";

/** The output's middleware, as server.d.ts declares it. */
type Middleware = (
	request: Request,
	handler: () => Response | Promise<Response>,
) => Promise<Response>;

it("binds each request's locale through Hono's middleware chain, and varies its response", async () => {
	const { dir, load } = project(
		{
			en: { title: "Your cart" },
			de: { title: "Ihr Warenkorb" },
			ar: { title: "سلتك" },
		},
		{ strategy: ["cookie"], cookieName: "lang" },
	);
	const { m } = await load();
	const { middleware }: { middleware: Middleware } = await import(
		pathToFileURL(join(dir, "out", "server.js")).href
	);
	let release = () => {};
	const allStarted = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started = 0;

	const app = new Hono();
	app.use(async (c, next) => {
		c.res = await middleware(c.req.raw, () => next().then(() => c.res));
	});
	app.get("/", async (c) => {
		const before = m.title?.();
		if (++started === 3) release();
		await allStarted;
		c.header("vary", "Accept-Encoding");
		return c.json([before, m.title?.()]);
	});
	const responses = await Promise.all(
		["de", "ar", "en"].map((locale) =>
			app.request("/", { headers: { cookie: `lang=${locale}` } }),
		),
	);

	expect(
		await Promise.all(responses.map((response) => response.json())),
	).toEqual([
		["Ihr Warenkorb", "Ihr Warenkorb"],
		["سلتك", "سلتك"],
		["Your cart", "Your cart"],
	]);
	expect(responses.map((response) => response.headers.get("vary"))).toEqual([
		"Accept-Encoding, Cookie",
		"Accept-Encoding, Cookie",
		"Accept-Encoding, Cookie",
	]);
});
