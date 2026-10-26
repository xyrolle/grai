import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IntegrationResolvedRoute } from "astro";
import type { Config } from "../config.ts";
import type { RoutePart } from "./route-paths.ts";

/**
 * The parameter that names a locale's prefix in the routes grai adds: `/[...0prefix]/despre` is
 * `/ro/despre`, and the base locale's `/despre` too. A grai parameter is a JavaScript identifier,
 * which this name is not, so the two never meet.
 */
const prefixParam = "0prefix";

/** What grai reads of a route `astro:routes:resolved` gives. */
export type ResolvedRoute = Pick<
	IntegrationResolvedRoute,
	| "type"
	| "isPrerendered"
	| "origin"
	| "pattern"
	| "pathname"
	| "segments"
	| "params"
	| "entrypoint"
>;

/** The module the added routes' page reads their paths from. */
export const translatedPathsId = "grai:astro/translated-paths";

/** The page of the routes grai adds, which lists their paths and renders nothing of its own. */
export const translatedPage: string = `---
// A path in a locale's words that grai's "pathnames" gives a page. grai's middleware renders the
// page's own route here; this page lists the paths a static build writes.
export { getStaticPaths } from "${translatedPathsId}";
---
`;

/**
 * The routes grai adds to Astro's so a static build writes each page at its paths in a locale's
 * words too: one for each such path that `pathnames` gives, the locale's prefix first, as Astro's
 * routes name parameters: `/[...0prefix]/produse/[id]`. Each is prerendered, and its page only
 * lists the paths: grai's middleware renders the page's route at each, as it does on demand.
 */
export function translatedPatterns(config: Config): string[] {
	return wordsOf(config).map(
		(words) => `/[...${prefixParam}]${words === "/" ? "" : words}`,
	);
}

/** Each path in a locale's words that `pathnames` gives, decoded, as a route has it. */
function wordsOf({ urlRouting }: Config): string[] {
	const words = urlRouting.pathnames.flatMap(({ route, paths }) =>
		paths.filter((path) => path !== route).map((path) => decodeURI(path)),
	);
	return [...new Set(words)];
}

/**
 * The prerendered pages, of all of Astro's routes, that may be at a path `pathnames` translates:
 * each whose pattern may route a path in a route's words under a locale's prefix, by the shapes
 * the two give such a path. Only these pages' `getStaticPaths()` grai runs again.
 */
export function translatablePages<Route extends ResolvedRoute>(
	routes: readonly Route[],
	config: Config,
): Route[] {
	const shapes = shapesOf(config);
	return routes.filter(
		(route) =>
			route.type === "page" &&
			route.isPrerendered &&
			route.origin !== "internal" &&
			!route.pattern.startsWith(`/[...${prefixParam}]`) &&
			shapes.some((shape) => mayRoute(route.segments, shape)),
	);
}

/**
 * The module the added routes' page lists their paths from: the pages that may be at a path
 * `pathnames` translates, each with its module, and the output's `pathOfRoute`.
 */
export function translatedPathsModule(
	routes: readonly ResolvedRoute[],
	config: Config,
	astro: { root: URL; base: string; trailingSlash: string },
): string {
	const root = fileURLToPath(astro.root);
	const pages = routes.map((route) => {
		const file = join(root, route.entrypoint).replaceAll("\\", "/");
		const shape = JSON.stringify({
			pattern: route.pattern,
			pathname: route.pathname,
			segments: route.segments,
			params: route.params,
		});
		return `\t{ ...${shape}, load: () => import(${JSON.stringify(file)}) },\n`;
	});
	const internal = JSON.stringify(join(config.outdir, "internal.js"));
	return `import { translatedStaticPaths } from "grai/astro/translated-paths";
import { pathOfRoute } from ${internal};

export const getStaticPaths = translatedStaticPaths({
	pathOfRoute,
	base: ${JSON.stringify(astro.base)},
	trailingSlash: ${JSON.stringify(astro.trailingSlash)},
	words: ${JSON.stringify(wordsOf(config))},
	routes: [
${pages.join("")}\t],
});
`;
}

/**
 * The shapes of the paths in a route's words that `pathnames` translates, each under the prefix
 * of a locale that translates it, or none for the base locale's: a segment's word, or null for
 * a parameter, which any word fills.
 */
function shapesOf({
	locales,
	baseLocale,
	urlRouting,
}: Config): (string | null)[][] {
	return urlRouting.pathnames.flatMap(({ route, paths }) =>
		locales.flatMap((locale, index) => {
			if (paths[index] === route) return [];
			const prefixed =
				urlRouting.localePrefix === "always" || locale !== baseLocale;
			const prefix = prefixed ? [urlRouting.prefixes[index] ?? locale] : [];
			const segments = decodeURI(route)
				.split("/")
				.filter(Boolean)
				.map((segment) => (/^\[.+\]$/.test(segment) ? null : segment));
			return [[...prefix, ...segments]];
		}),
	);
}

/**
 * Whether a route of these segments may route some path of the shape: a rest parameter takes any
 * number of its segments, a parameter any word, and a segment's words must be the shape's.
 */
function mayRoute(
	route: readonly (readonly RoutePart[])[],
	shape: readonly (string | null)[],
): boolean {
	const [segment, ...rest] = route;
	if (segment === undefined) return shape.length === 0;
	if (segment.some((part) => part.spread)) {
		return (
			shape.some((_, taken) => mayRoute(rest, shape.slice(taken))) ||
			mayRoute(rest, [])
		);
	}
	const [word, ...others] = shape;
	if (word === undefined) return false;
	return (word === null || takes(segment, word)) && mayRoute(rest, others);
}

/** Whether a segment's parts take a word: its own words as they are, a parameter any text. */
function takes(parts: readonly RoutePart[], word: string): boolean {
	const pattern = parts
		.map(({ content, dynamic }) =>
			dynamic ? ".+" : content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("");
	return new RegExp(`^${pattern}$`).test(word);
}
