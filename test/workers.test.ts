import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { compile } from "../src/index.ts";
import { type Runtime, serve } from "./serve.ts";

// The Workers example (examples/workers), compiled, then served by each runtime that runs a
// Worker's module as it is: workerd, Cloudflare's runtime, through Wrangler's test harness, Bun and
// Deno. Beside it, each serves two Workers on the example's output: one interleaves requests, and
// one streams its body as SvelteKit streams a page.
const example = fileURLToPath(new URL("../examples/workers/", import.meta.url));
const interleaving = fileURLToPath(
	new URL("workers-interleave.js", import.meta.url),
);
const streaming = fileURLToPath(new URL("workers-stream.js", import.meta.url));
const locales = ["en", "ro", "ar"] as const;
const titleOf = (locale: string): string =>
	JSON.parse(readFileSync(`${example}messages/${locale}.json`, "utf8")).title;
/** The interleaving Worker's 30 requests, in the order it sends them: ten in each locale, in turn. */
const sent = Array.from({ length: 10 }, () => locales).flat();

/** A request to one of the Workers, and what the tests read of its response. */
type Fetch = (
	path: string,
	init: { headers: Record<string, string> },
) => Promise<{
	headers: { get(name: string): string | null };
	text(): Promise<string>;
	json(): Promise<unknown>;
}>;

/** A runtime serving the example, the interleaving Worker and the streaming one. */
type Servers = {
	listen(): Promise<void>;
	close(): Promise<void>;
	example: Fetch;
	interleave: Fetch;
	stream: Fetch;
};

/**
 * workerd, with the example at Workers' default Node.js compatibility, and the test's Workers at
 * the last date before it, with only the flag that adds AsyncLocalStorage: the least a Worker
 * needs for grai's middleware.
 */
function workerd(): Servers {
	const leastCompatible = (name: string, main: string) => ({
		config: {
			name,
			main,
			compatibility_date: "2026-08-03",
			compatibility_flags: ["nodejs_als"],
		},
	});
	const harness = createTestHarness({
		workers: [
			{ configPath: `${example}wrangler.jsonc` },
			leastCompatible("interleave", interleaving),
			leastCompatible("stream", streaming),
		],
	});
	const interleave = harness.getWorker("interleave");
	const stream = harness.getWorker("stream");
	return {
		listen: async () => {
			await harness.listen();
		},
		close: () => harness.close(),
		example: (path, init) => harness.fetch(path, init),
		interleave: (path, init) => interleave.fetch(path, init),
		stream: (path, init) => stream.fetch(path, init),
	};
}

/** Bun or Deno, serving each Worker's module as it is. */
function servedBy(runtime: Runtime): Servers {
	const workers = {
		example: serve(runtime, `${example}src/worker.js`),
		interleave: serve(runtime, interleaving),
		stream: serve(runtime, streaming),
	};
	const all = Object.values(workers);
	return {
		listen: async () => {
			await Promise.all(all.map((worker) => worker.listen()));
		},
		close: async () => {
			await Promise.all(all.map((worker) => worker.close()));
		},
		example: workers.example.fetch,
		interleave: workers.interleave.fetch,
		stream: workers.stream.fetch,
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

	it("streams every line its start() pushes after awaits in the request's locale, as SvelteKit's pages", async () => {
		const response = await servers.stream("/", {
			headers: { cookie: "lang=ro" },
		});

		expect(await response.text()).toBe(`${titleOf("ro")}\n`.repeat(4));
	});

	describe("30 requests interleaved, ten in each locale", () => {
		/** What the interleaving Worker's 30 requests answered, in the order it sent them. */
		const answers = async (query = "") =>
			(await servers.interleave(`/${query}`, { headers: {} })).json();

		it("keeps each request in its own locale", async () => {
			expect(await answers()).toEqual(
				sent.map((locale) => ({
					locale,
					bound: locale,
					renders: [titleOf(locale), titleOf(locale)],
				})),
			);
		});

		it("lets setLocale switch only the request that calls it", async () => {
			const switchedTo = (locale: string) => (locale === "ro" ? "ar" : locale);

			expect(await answers("?switch=ro:ar")).toEqual(
				sent.map((locale) => ({
					locale,
					bound: switchedTo(locale),
					renders: [titleOf(locale), titleOf(switchedTo(locale))],
				})),
			);
		});
	});
});
