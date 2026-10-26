import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { project } from "./project.ts";

// The middleware's parts that the output's server.js exports for a framework that renders apart
// from the middleware: the locale it binds, the redirect it answers, and the Vary it adds.

const catalogs = {
	en: { title: "Your cart" },
	de: { title: "Ihr Warenkorb" },
	ar: { title: "سلتك" },
};

/** The output's server.js, for a project with `config`. */
async function server(config: Record<string, unknown>) {
	const { dir, load } = project(catalogs, config);
	await load();
	return import(pathToFileURL(join(dir, "out", "server.js")).href);
}

describe("the middleware's parts, for a framework that renders apart from it", () => {
	it("finds the locale the middleware binds, and the headers it varies by", async () => {
		const { localeOf, vary } = await server({
			strategy: ["cookie", "preferredLanguage"],
			cookieName: "lang",
		});
		const lookup = (headers: Record<string, string>): unknown =>
			localeOf(new Request("https://shop.test/", { headers }));

		expect([
			lookup({ cookie: "lang=ar", "accept-language": "de" }),
			lookup({ "accept-language": "de-AT, en;q=0.5" }),
			lookup({}),
			vary,
		]).toEqual(["ar", "de", "en", "Cookie, Accept-Language"]);
	});

	it("finds the redirect the middleware answers a page without a prefix with, its Vary included", async () => {
		const { redirectOf } = await server({
			strategy: ["url", "cookie"],
			cookieName: "lang",
			localePrefix: "always",
		});
		const answer = (path: string, init: RequestInit = {}) => {
			const response: Response | undefined = redirectOf(
				new Request(`https://shop.test${path}`, init),
			);
			return (
				response && [
					response.status,
					response.headers.get("location"),
					response.headers.get("vary"),
				]
			);
		};

		expect([
			answer("/cart?step=2", { headers: { cookie: "lang=ar" } }),
			answer("/de/cart"),
			answer("/cart", { method: "POST" }),
		]).toEqual([
			[307, "https://shop.test/ar/cart?step=2", "Cookie"],
			undefined,
			undefined,
		]);
	});
});
