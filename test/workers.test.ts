import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { compile } from "../src/index.ts";
import { type Runtime, serve } from "./serve.ts";

// The Workers example (examples/workers), compiled, then served by each runtime that runs a
// Worker's module as it is: workerd, Cloudflare's runtime, through Wrangler's test harness, Bun and
// Deno. Beside it, each serves a Worker that interleaves requests on the example's output.
const example = fileURLToPath(new URL("../examples/workers/", import.meta.url));
const interleaving = fileURLToPath(
	new URL("workers-interleave.js", import.meta.url),
);
const locales = ["en", "ro", "ar"] as const;
const titleOf = (locale: string): string =>
	JSON.parse(readFileSync(`${example}messages/${locale}.json`, "utf8")).title;
/** 30 requests, ten in each locale, in turn. */
const sent = Array.from({ length: 10 }, () => locales).flat();

/** A request to one of the two Workers, and what the tests read of its response. */
type Fetch = (
	path: string,
	init: { headers: Record<string, string> },
) => Promise<{
	headers: { get(name: string): string | null };
	text(): Promise<string>;
	json(): Promise<unknown>;
}>;

/** A runtime serving the example and the interleaving Worker. */
type Servers = {
	listen(): Promise<void>;
	close(): Promise<void>;
	example: Fetch;
	interleave: Fetch;
};

/**
 * workerd, with the example at Workers' default Node.js compatibility, and the interleaving Worker
 * at the last date before it, with only the flag that adds AsyncLocalStorage: the least a Worker
 * needs for grai's middleware.
 */
function workerd(): Servers {
	const harness = createTestHarness({
		workers: [
			{ configPath: `${example}wrangler.jsonc` },
			{
				config: {
					name: "interleave",
					main: interleaving,
					compatibility_date: "2026-08-03",
					compatibility_flags: ["nodejs_als"],
				},
			},
		],
	});
	const interleave = harness.getWorker("interleave");
	return {
		listen: async () => {
			await harness.listen();
		},
		close: () => harness.close(),
		example: (path, init) => harness.fetch(path, init),
		interleave: (path, init) => interleave.fetch(path, init),
	};
}

/** Bun or Deno, serving each Worker's module as it is. */
function servedBy(runtime: Runtime): Servers {
	const workers = {
		example: serve(runtime, `${example}src/worker.js`),
		interleave: serve(runtime, interleaving),
	};
	const both = Object.values(workers);
	return {
		listen: async () => {
			await Promise.all(both.map((worker) => worker.listen()));
		},
		close: async () => {
			await Promise.all(both.map((worker) => worker.close()));
		},
		example: workers.example.fetch,
		interleave: workers.interleave.fetch,
	};
}

beforeAll(async () => {
	expect((await compile(`${example}grai.config.json`)).errors).toEqual([]);
});

describe.each([
	["workerd", workerd()],
	["Bun", servedBy("bun")],
	["Deno", servedBy("deno")],
])("in %s", (_, servers) => {
	beforeAll(() => servers.listen(), 30_000);
	afterAll(() => servers.close());

	describe("the example", () => {
		/** The page's locale, direction and title, for a request with `headers`. */
		const rendered = async (headers: Record<string, string>) => {
			const html = await (await servers.example("/", { headers })).text();
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
			const response = await servers.example("/", { headers: {} });

			expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");
		});
	});

	describe("30 requests interleaved, ten in each locale", () => {
		/** The interleaving Worker's answers to `sent`, all in flight at once. */
		const answers = (sent: { locale: string; switchTo?: string }[]) =>
			Promise.all(
				sent.map(async ({ locale, switchTo }) => {
					const query = new URLSearchParams({
						requests: String(sent.length),
						...(switchTo === undefined ? {} : { switchTo }),
					});
					const response = await servers.interleave(`/?${query}`, {
						headers: { cookie: `lang=${locale}` },
					});
					return response.json();
				}),
			);

		it("keeps each request in its own locale", async () => {
			expect(await answers(sent.map((locale) => ({ locale })))).toEqual(
				sent.map((locale) => ({
					locale,
					bound: locale,
					renders: [titleOf(locale), titleOf(locale)],
				})),
			);
		});

		it("lets setLocale switch only the request that calls it", async () => {
			const switching = sent.map((locale) =>
				locale === "ro" ? { locale, switchTo: "ar" } : { locale },
			);

			expect(await answers(switching)).toEqual(
				switching.map(({ locale, switchTo = locale }) => ({
					locale,
					bound: switchTo,
					renders: [titleOf(locale), titleOf(switchTo)],
				})),
			);
		});
	});
});
