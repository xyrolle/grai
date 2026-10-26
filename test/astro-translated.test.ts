import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { RoutePart } from "../src/astro/route-paths.ts";
import {
	type PageRoute,
	translatedStaticPaths,
} from "../src/astro/translated-paths.ts";
import {
	type ResolvedRoute,
	translatablePages,
	translatedPatterns,
} from "../src/astro/translated-routes.ts";
import { readConfig } from "../src/config.ts";
import { project } from "./project.ts";

const pathnames = {
	"/about": { ro: "/despre", ar: "/حول" },
	"/products/[id]": { ro: "/produse/[id]" },
};

/** A project's config and its output's `pathOfRoute`, compiled with `pathnames`. */
async function compiled(config: Record<string, unknown> = {}) {
	const {
		dir,
		config: file,
		load,
	} = project(
		{ en: { title: "Cart" }, ro: { title: "Coș" }, ar: { title: "سلة" } },
		{ strategy: ["url"], pathnames, ...config },
	);
	await load();
	const internal: { pathOfRoute(url: URL): string } = await import(
		pathToFileURL(join(dir, "out", "internal.js")).href
	);
	return { config: readConfig(file), pathOfRoute: internal.pathOfRoute };
}

/** A route's segments as Astro parses its pattern: `[id]` a parameter, `[...x]` a rest one. */
function segments(pattern: string): RoutePart[][] {
	return pattern
		.split("/")
		.filter(Boolean)
		.map((segment) =>
			segment.split(/(\[[^\]]+\])/).flatMap((part) => {
				if (part === "") return [];
				const content = /^\[(.+)\]$/.exec(part)?.[1];
				return [
					content === undefined
						? { content: part, dynamic: false, spread: false }
						: { content, dynamic: true, spread: content.startsWith("...") },
				];
			}),
		);
}

/** A route as `astro:routes:resolved` gives it: a prerendered page unless `rest` says not. */
function resolved(
	pattern: string,
	rest: Partial<ResolvedRoute> = {},
): ResolvedRoute {
	const parts = segments(pattern);
	const params = parts
		.flat()
		.flatMap((part) => (part.dynamic ? [part.content] : []));
	return {
		type: "page",
		isPrerendered: true,
		origin: "project",
		pattern,
		...(params.length === 0 ? { pathname: pattern } : {}),
		segments: parts,
		params,
		entrypoint: `src/pages${pattern}.astro`,
		...rest,
	};
}

describe("the routes grai adds for the paths in a locale's words", () => {
	it("adds one prerendered route for each such path, the locale's prefix a rest parameter", async () => {
		const { config } = await compiled();

		expect(translatedPatterns(config)).toEqual([
			"/[...0prefix]/despre",
			"/[...0prefix]/حول",
			"/[...0prefix]/produse/[id]",
		]);
	});

	it("reads again only the prerendered pages a path in a route's words may be at", async () => {
		const { config } = await compiled();
		const routes = [
			resolved("/[...locale]/about"),
			resolved("/[...locale]/products/[id]"),
			resolved("/[...path]"),
			resolved("/ro/about"),
			resolved("/[lang]/[item]"),
			resolved("/[...locale]/contact"),
			resolved("/blog/[slug]"),
			resolved("/item-[id]"),
			resolved("/[...locale]/about", { isPrerendered: false }),
			resolved("/[...locale]/about", { type: "endpoint" }),
			resolved("/[...0prefix]/despre"),
		];

		expect(
			translatablePages(routes, config).map((route) => route.pattern),
		).toEqual([
			"/[...locale]/about",
			"/[...locale]/products/[id]",
			"/[...path]",
			"/ro/about",
			"/[lang]/[item]",
			// A rest parameter may hold more than a prefix: `/ro/products/contact` is one of its paths.
			"/[...locale]/contact",
		]);
	});
});

describe("the paths a static build writes in a locale's words", () => {
	/**
	 * A page whose getStaticPaths() gives its paths of `ids` under each locale's prefix, none for
	 * the base locale's by default, counting its calls.
	 */
	function page(
		pattern: string,
		ids: string[] = [],
		prefixes: (string | undefined)[] = [undefined, "ro", "ar"],
	) {
		const route = resolved(pattern);
		let calls = 0;
		const page: PageRoute = {
			...route,
			load: async () => ({
				getStaticPaths: () => {
					calls++;
					return prefixes.flatMap((locale) =>
						route.params.includes("id")
							? ids.map((id) => ({ params: { locale, id } }))
							: [{ params: { locale } }],
					);
				},
			}),
		};
		return { page, calls: () => calls };
	}

	it("gives each added route the params of the pages at its words, reading each page once", async () => {
		const { pathOfRoute } = await compiled();
		const about = page("/[...locale]/about");
		const products = page("/[...locale]/products/[id]", ["7", "a b"]);
		const getStaticPaths = translatedStaticPaths({
			routes: [about.page, products.page],
			words: ["/despre", "/حول", "/produse/[id]"],
			pathOfRoute,
			base: "/",
			trailingSlash: "ignore",
		});
		const paths = (routePattern: string) => getStaticPaths({ routePattern });

		expect(await paths("/[...0prefix]/despre")).toEqual([
			{ params: { "0prefix": "ro" } },
		]);
		expect(await paths("/[...0prefix]/حول")).toEqual([
			{ params: { "0prefix": "ar" } },
		]);
		expect(await paths("/[...0prefix]/produse/[id]")).toEqual([
			{ params: { "0prefix": "ro", id: "7" } },
			{ params: { "0prefix": "ro", id: "a b" } },
		]);
		expect([about.calls(), products.calls()]).toEqual([1, 1]);
	});

	it("gives the base locale's words without a prefix, and each locale's under its own", async () => {
		const asNeeded = await compiled({
			pathnames: { "/about": { en: "/about-us", ro: "/despre" } },
		});
		const always = await compiled({
			pathnames: { "/about": { en: "/about-us", ro: "/despre" } },
			localePrefix: "always",
			localePrefixes: { ro: "romana" },
		});
		const paths = async (
			pathOfRoute: (url: URL) => string,
			prefixes: (string | undefined)[],
		) => {
			const getStaticPaths = translatedStaticPaths({
				routes: [page("/[...locale]/about", [], prefixes).page],
				words: ["/about-us", "/despre"],
				pathOfRoute,
				base: "/",
				trailingSlash: "ignore",
			});
			return Promise.all(
				["/[...0prefix]/about-us", "/[...0prefix]/despre"].map((routePattern) =>
					getStaticPaths({ routePattern }),
				),
			);
		};

		expect(await paths(asNeeded.pathOfRoute, [undefined, "ro", "ar"])).toEqual([
			[{ params: { "0prefix": undefined } }],
			[{ params: { "0prefix": "ro" } }],
		]);
		expect(await paths(always.pathOfRoute, ["en", "romana", "ar"])).toEqual([
			[{ params: { "0prefix": "en" } }],
			[{ params: { "0prefix": "romana" } }],
		]);
	});
});
