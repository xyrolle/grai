import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { compile } from "../src/index.ts";

// The Workers example (examples/workers), compiled, then run in workerd, Cloudflare's runtime, by
// Wrangler's test harness, beside a Worker that interleaves requests on the example's output.
const example = fileURLToPath(new URL("../examples/workers/", import.meta.url));
const locales = ["en", "ro", "ar"] as const;
const titleOf = (locale: string): string =>
	JSON.parse(readFileSync(`${example}messages/${locale}.json`, "utf8")).title;
/** 30 requests, ten in each locale, in turn. */
const sent = Array.from({ length: 10 }, () => locales).flat();

const server = createTestHarness({
	workers: [
		{ configPath: `${example}wrangler.jsonc` },
		{
			config: {
				name: "interleave",
				main: fileURLToPath(new URL("workers-interleave.js", import.meta.url)),
				// The last date before Node.js compatibility became the default, with only the flag that
				// adds AsyncLocalStorage: the least a Worker needs for grai's middleware.
				compatibility_date: "2026-08-03",
				compatibility_flags: ["nodejs_als"],
			},
		},
	],
});

beforeAll(async () => {
	expect((await compile(`${example}grai.config.json`)).errors).toEqual([]);
	await server.listen();
}, 30_000);
afterAll(() => server.close());

describe("the example, with Workers' default Node.js compatibility", () => {
	/** The page's locale, direction and title, for a request with `headers`. */
	const rendered = async (headers: Record<string, string>) => {
		const html = await (await server.fetch("/", { headers })).text();
		return /<html lang="(.*)" dir="(.*)">\n<title>(.*)<\/title>/
			.exec(html)
			?.slice(1);
	};

	it("renders a page in the locale the cookie names, else Accept-Language, else the base locale", async () => {
		expect(
			await rendered({
				cookie: "theme=dark; lang=ar",
				"accept-language": "ro",
			}),
		).toEqual(["ar", "rtl", titleOf("ar")]);
		expect(await rendered({ "accept-language": "ro-RO, en;q=0.5" })).toEqual([
			"ro",
			"ltr",
			titleOf("ro"),
		]);
		expect(await rendered({})).toEqual(["en", "ltr", titleOf("en")]);
	});

	it("lists in Vary the request headers the locale is read from", async () => {
		const response = await server.fetch("/");

		expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");
	});
});

it("keeps each of 30 interleaved requests in its own locale, with only nodejs_als", async () => {
	const worker = server.getWorker("interleave");

	const answered = await Promise.all(
		sent.map(async (locale) =>
			(
				await worker.fetch(`/?requests=${sent.length}`, {
					headers: { cookie: `lang=${locale}` },
				})
			).json(),
		),
	);

	expect(answered).toEqual(
		sent.map((locale) => ({
			locale,
			bound: locale,
			renders: [titleOf(locale), titleOf(locale)],
		})),
	);
});
