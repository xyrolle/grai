import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	checkedStaticPaths,
	paginateFor,
	pathOfParams,
	type RoutePart,
	type RouteShape,
} from "../src/astro/route-paths.ts";

// grai's copies of what Astro does with a page's getStaticPaths(), run beside Astro's own from the
// installed astro, whose modules its package does not export: a change in Astro's fails here.
const astro = dirname(
	createRequire(import.meta.url).resolve("astro/package.json"),
);
const internal = async (path: string) =>
	import(pathToFileURL(join(astro, "dist", path)).href);
const { stringifyParams } = await internal("core/routing/params.js");
const { generatePaginateFunction } = await internal("core/render/paginate.js");
const { validateGetStaticPathsResult } = await internal(
	"core/routing/validation.js",
);
const { getParts } = await internal("core/routing/parts.js");

/** A page's route as Astro reads it from its file's path under src/pages. */
function route(pattern: string): RouteShape & {
	route: string;
	component: string;
	type: "page";
} {
	const segments: RoutePart[][] = pattern
		.split("/")
		.filter(Boolean)
		.map((segment) => getParts(segment, pattern));
	const params = segments
		.flat()
		.filter((part) => part.dynamic)
		.map((part) => part.content);
	return {
		route: pattern,
		component: "page.astro",
		type: "page",
		segments,
		params,
	};
}

/** What a call gives, or the message of what it throws. */
function outcome(call: () => unknown): unknown {
	try {
		return call();
	} catch (error) {
		return { thrown: error instanceof Error ? error.message : error };
	}
}

const patterns = [
	"/",
	"/[...locale]",
	"/[...locale]/about",
	"/[...locale]/products/[id]",
	"/[lang]/[...slug]",
	"/docs/[...path]/edit",
	"/item-[id]",
	"/[a]-[b]",
	"/știri/[slug]",
	"/a%5Bx%5D/[id]",
];
const values = [
	undefined,
	"",
	"ro",
	"a/b",
	"/lead/",
	"été",
	"a#b?c",
	"100%",
	"//double//",
	"%20",
	"two words",
	7,
	null,
	true,
];

describe("Astro's reading of getStaticPaths(), as grai writes it", () => {
	it("writes each page's path from its params as Astro's stringifyParams does", () => {
		for (const pattern of patterns) {
			const page = route(pattern);
			for (const value of values) {
				for (const trailingSlash of ["always", "never", "ignore"]) {
					const params = Object.fromEntries(
						page.params.map((name) => [name.replace(/^\.{3}/, ""), value]),
					);
					expect(
						outcome(() => pathOfParams(params, page, trailingSlash)),
						`${pattern} ${String(value)} ${trailingSlash}`,
					).toEqual(
						outcome(() => stringifyParams(params, page, trailingSlash)),
					);
				}
			}
		}
	});

	it("pages data as Astro's paginate does, params and URLs alike", () => {
		const data = (length: number) => Array.from({ length }, (_, n) => n);
		for (const pattern of [
			"/[...locale]/blog/[page]",
			"/[...locale]/blog/[...page]",
			"/blog",
		]) {
			for (const base of ["/", "/shop", "/shop/"]) {
				for (const trailingSlash of ["always", "never"]) {
					for (const [length, options] of [
						[0, undefined],
						[1, {}],
						[25, { pageSize: 10, params: { locale: "ro" } }],
						[25, { pageSize: 0, params: { locale: undefined } }],
						[7, { pageSize: Number.POSITIVE_INFINITY, props: { tag: "x" } }],
						[12, { pageSize: 5, format: (url: string) => `${url}?v=1` }],
					] as const) {
						const page = route(pattern);
						expect(
							outcome(() =>
								paginateFor(page, base, trailingSlash)(data(length), options),
							),
							`${pattern} ${base} ${trailingSlash} ${length}`,
						).toEqual(
							outcome(() =>
								generatePaginateFunction(
									page,
									base,
									trailingSlash,
								)(data(length), options),
							),
						);
					}
				}
			}
		}
	});

	it("checks what getStaticPaths() gives as Astro does", () => {
		const page = route("/[...locale]/about");
		for (const result of [
			"paths",
			undefined,
			[null],
			[["ro"]],
			[{}],
			[{ params: {} }],
			[{ params: null }],
			[{ params: true }],
			["ro"],
			[{ params: { locale: "ro" } }, { params: { locale: undefined } }],
		]) {
			expect(
				outcome(() => checkedStaticPaths(result)),
				String(result),
			).toEqual(
				outcome(() => {
					validateGetStaticPathsResult(result, page);
					return result;
				}),
			);
		}
	});
});
