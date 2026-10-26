import type { NuxtPage } from "nuxt/schema";
import { globMatcher } from "../globs.ts";
import type { UrlRouting } from "../url-routing.ts";

/** What joins a page's name and its locale in a copy's name, as @nuxtjs/i18n names its copies. */
const separator = "___";

/** A segment Nuxt names, such as `:id()` for `[id].vue`, and the name. */
const nuxtParameter = /^:([A-Za-z_$][\w$]*)/;
/** A segment grai's `pathnames` names: `[id]`. */
const graiParameter = /^\[([A-Za-z_$][\w$]*)\]$/;

/**
 * The pages again under each prefixed locale's prefix: the paths the `url` strategy reads
 * (`/ro/about`), routed to the same pages, in the locale's words where `pathnames` give them
 * (`/ro/despre`). The base locale's paths have no prefix unless every locale's do; a page its own
 * words give another path is routed there too. With `domains`, a locale's paths have no prefix on
 * its own host, so a copy is routed at its words without the prefix too (`/despre`). A page at a
 * path the strategy leaves alone has no copies. A copy's name is its page's with its locale, so
 * every route's name stays unique, and a name still leads to the unprefixed page.
 */
export function localizedPages(
	pages: readonly NuxtPage[],
	locales: readonly string[],
	baseLocale: string,
	routing: UrlRouting,
): NuxtPage[] {
	const leftAlone = globMatcher(routing.unlocalizedPaths);
	const localized = pages.filter((page) => !leftAlone(page.path));
	const hosted = routing.domains.length > 0;
	return locales.flatMap((locale, index) => {
		const words = (path: string) => inWords(path, routing, index);
		if (routing.localePrefix === "always" || locale !== baseLocale) {
			const prefix = routing.prefixes[index] ?? locale;
			const prefixed = (path: string) => {
				const translated = words(path);
				return `/${prefix}${translated === "/" ? "" : translated}`;
			};
			return localized.map((page) =>
				localizedPage(page, locale, prefixed, hosted ? words : undefined),
			);
		}
		return localized
			.filter((page) => words(page.path) !== page.path)
			.map((page) => localizedPage(page, locale, words));
	});
}

/**
 * A page and its children in a locale: each absolute path as `pathOf` gives it, relative ones as
 * they are, and each absolute path as `hostedPathOf` gives it too, where that is not the page's
 * own path, which the page itself is routed at.
 */
function localizedPage(
	page: NuxtPage,
	locale: string,
	pathOf: (path: string) => string,
	hostedPathOf?: (path: string) => string,
): NuxtPage {
	const localizedPath = (path: string) =>
		absolute(path) ? pathOf(path) : path;
	const hostedPath = (path: string) => {
		const hosted = absolute(path) ? hostedPathOf?.(path) : undefined;
		return hosted === undefined || hosted === path ? [] : [hosted];
	};
	const { name, alias, children } = page;
	const paths = [page.path, ...(alias === undefined ? [] : [alias].flat())];
	const aliases = [
		...paths.slice(1).map(localizedPath),
		...paths.flatMap(hostedPath),
	];
	return {
		...page,
		path: localizedPath(page.path),
		...(name === undefined ? {} : { name: `${name}${separator}${locale}` }),
		...(aliases.length === 0 ? {} : { alias: aliases }),
		...(children === undefined
			? {}
			: {
					children: children.map((child) =>
						localizedPage(child, locale, pathOf, hostedPathOf),
					),
				}),
	};
}

/** A path two pages are routed at without a prefix: one locale's words, and the page they lead to. */
export type SharedPath = {
	path: string;
	locale: string;
	/** The files of the page already routed at the path, and of the page the locale's words give it. */
	pages: [string, string];
};

/**
 * The first path without a prefix that a locale's words give a page while another is routed there:
 * Nuxt routes a page by its path alone, the same on every host, so the path would lead to one of
 * them on every locale's. A locale's paths have no prefix on its own host, with `domains`, and the
 * base locale's everywhere unless every locale's have one. Paths are compared by their shape, as
 * the router matches them: `/p/:id()` is `/p/:slug()`.
 */
export function sharedPath(
	pages: readonly NuxtPage[],
	locales: readonly string[],
	baseLocale: string,
	routing: UrlRouting,
): SharedPath | undefined {
	const routed = absolutePages(pages);
	// Of two pages at one path, the router takes the first.
	const owners = new Map<string, NuxtPage>();
	for (const page of routed) {
		for (const path of pathsOf(page)) {
			if (!owners.has(shape(path))) owners.set(shape(path), page);
		}
	}
	const leftAlone = globMatcher(routing.unlocalizedPaths);
	const unprefixed = locales.flatMap((locale, index) =>
		routing.domains.length > 0 ||
		(routing.localePrefix === "as-needed" && locale === baseLocale)
			? [{ locale, index }]
			: [],
	);
	for (const { locale, index } of unprefixed) {
		for (const page of routed.filter((page) => !leftAlone(page.path))) {
			for (const path of pathsOf(page)) {
				const words = inWords(path, routing, index);
				if (words === path) continue;
				const owner = owners.get(shape(words)) ?? page;
				if (owner !== page) {
					return {
						path: words,
						locale,
						pages: [owner.file ?? owner.path, page.file ?? page.path],
					};
				}
				owners.set(shape(words), page);
			}
		}
	}
	return undefined;
}

/** The pages and, through their children, each page at a path of its own: an absolute one. */
function absolutePages(pages: readonly NuxtPage[]): NuxtPage[] {
	return pages.flatMap((page) => [
		...(absolute(page.path) ? [page] : []),
		...absolutePages(page.children ?? []),
	]);
}

function pathsOf({ path, alias }: NuxtPage): string[] {
	return [path, ...(alias === undefined ? [] : [alias].flat())].filter(
		absolute,
	);
}

function absolute(path: string): boolean {
	return path.startsWith("/");
}

/** A path as the router tells it from others: each segment Nuxt names, by its pattern alone. */
function shape(path: string): string {
	return path.replace(/:[A-Za-z_$][\w$]*/g, ":");
}

/**
 * A page's path in a locale's words, by its position in `locales`, where `pathnames` give the
 * page's route some: its segments as Nuxt names them (`:id()`), its words as a router reads them.
 * Else the path as it is.
 */
function inWords(path: string, routing: UrlRouting, locale: number): string {
	const segments = path.split("/");
	const nuxtSegments = new Map(
		segments.flatMap((segment) => {
			const name = nuxtParameter.exec(segment)?.[1];
			return name === undefined ? [] : [[name, segment] as const];
		}),
	);
	const route = segments
		.map((segment) => {
			const name = nuxtParameter.exec(segment)?.[1];
			return name === undefined ? segment : `[${name}]`;
		})
		.join("/");
	const words = routing.pathnames.find(
		(pathname) => decodeURI(pathname.route) === route,
	)?.paths[locale];
	if (words === undefined) return path;
	return decodeURI(words)
		.split("/")
		.map((segment) => {
			const name = graiParameter.exec(segment)?.[1];
			return name === undefined ? segment : (nuxtSegments.get(name) ?? segment);
		})
		.join("/");
}
