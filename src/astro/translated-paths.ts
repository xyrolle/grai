import {
	checkedStaticPaths,
	paginateFor,
	pathOfParams,
	type RouteShape,
	type StaticPathsOptions,
} from "./route-paths.ts";

/** A prerendered page's route, as `astro:routes:resolved` gives it, and its module. */
export type PageRoute = RouteShape & {
	/** Its pattern, as its `getStaticPaths()` is given it: `/[...locale]/about`. */
	pattern: string;
	/** Its one path, where it has no parameters. */
	pathname?: string | undefined;
	load(): Promise<{
		getStaticPaths?: (options: StaticPathsOptions) => unknown;
	}>;
};

/** What finds a static build's pages in a locale's words. */
export type TranslatedPages = {
	/** The pages that may be at a path `pathnames` translates. */
	routes: readonly PageRoute[];
	/** Each path in a locale's words, as a route of its own has it: `/produse/[id]`. */
	words: readonly string[];
	/** `pathOfRoute` from the output's `internal.js`. */
	pathOfRoute(url: URL): string;
	/** Astro's `base` and `trailingSlash`, which `paginate` writes its URLs by. */
	base: string;
	trailingSlash: string;
};

type Params = Record<string, string | undefined>;

/** A page's path in a route's words: its locale's prefix, if it has one, and the words' params. */
type WordsParams = { prefix: string | undefined; words: Params };

/**
 * The `getStaticPaths()` of the routes grai adds for the paths in a locale's words, each a rest
 * parameter for the locale's prefix and then the words: `/[...0prefix]/produse/[id]`. It gives the
 * params of each prerendered page's path that `pathnames` translates into the route's words. Each
 * page's own `getStaticPaths()` gives its paths, and grai's middleware renders the page at its
 * path in the locale's words, as it does on demand. The routes share one reading of the pages.
 */
export function translatedStaticPaths(
	project: TranslatedPages,
): (options: { routePattern: string }) => Promise<{ params: Params }[]> {
	let found: Promise<Map<string, WordsParams[]>> | undefined;
	return async ({ routePattern }) => {
		found ??= translatedPages(project);
		// `/[...0prefix]/produse/[id]`: the prefix's parameter, then the words.
		const end = routePattern.indexOf("/", 1);
		const prefix = end === -1 ? routePattern : routePattern.slice(0, end);
		const words = end === -1 ? "/" : routePattern.slice(end);
		const name = prefix.slice("/[...".length, -"]".length);
		return ((await found).get(words) ?? []).map((params) => ({
			params: { [name]: params.prefix, ...params.words },
		}));
	};
}

/** Each path in a locale's words that a page is at, by its route's words, as its params. */
async function translatedPages({
	routes,
	words,
	pathOfRoute,
	base,
	trailingSlash,
}: TranslatedPages): Promise<Map<string, WordsParams[]>> {
	const patterns = words.map((path) => ({ path, segments: segmentsOf(path) }));
	const found = new Map<string, Map<string, WordsParams>>();
	const paths = await Promise.all(
		routes.map((route) => pathsOf(route, base, trailingSlash)),
	);
	for (const path of paths.flat()) {
		const url = new URL(path, "http://localhost");
		const translated = pathOfRoute(url);
		if (translated === url.pathname) continue;
		const segments = segmentsOf(decodeURI(translated));
		for (const pattern of patterns) {
			const params = paramsOf(pattern.segments, segments);
			if (params === undefined) continue;
			const pages = found.get(pattern.path) ?? new Map<string, WordsParams>();
			pages.set(translated, params);
			found.set(pattern.path, pages);
			break;
		}
	}
	return new Map(
		[...found].map(([path, pages]) => [path, [...pages.values()]]),
	);
}

/** A prerendered page's paths: its one path, or those its `getStaticPaths()` gives. */
async function pathsOf(
	route: PageRoute,
	base: string,
	trailingSlash: string,
): Promise<string[]> {
	if (route.pathname !== undefined) return [route.pathname];
	// Astro itself reports a dynamic page without getStaticPaths().
	const { getStaticPaths } = await route.load();
	if (getStaticPaths === undefined) return [];
	const entries = checkedStaticPaths(
		await getStaticPaths({
			paginate: paginateFor(route, base, trailingSlash),
			routePattern: route.pattern,
		}),
	);
	return entries.map(({ params }) => pathOfParams(params, route, "never"));
}

function segmentsOf(path: string): string[] {
	return path === "/" ? [] : path.slice(1).split("/");
}

/**
 * The params of a path in a route's words, its locale's prefix first where it has one more
 * segment than the words; undefined where the words do not match it.
 */
function paramsOf(
	words: readonly string[],
	path: readonly string[],
): WordsParams | undefined {
	const prefixed = path.length === words.length + 1;
	if (!prefixed && path.length !== words.length) return undefined;
	const after = prefixed ? path.slice(1) : path;
	const params: Params = {};
	for (const [index, word] of words.entries()) {
		const name = /^\[([A-Za-z_$][\w$]*)\]$/.exec(word)?.[1];
		if (name !== undefined) params[name] = after[index];
		else if (word !== after[index]) return undefined;
	}
	return { prefix: prefixed ? path[0] : undefined, words: params };
}
