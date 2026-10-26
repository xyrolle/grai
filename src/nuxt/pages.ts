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
 * words give another path is routed there too. A page at a path the strategy leaves alone has no
 * copies. A copy's name is its page's with its locale, so every route's name stays unique, and a
 * name still leads to the unprefixed page.
 */
export function localizedPages(
	pages: readonly NuxtPage[],
	locales: readonly string[],
	baseLocale: string,
	routing: UrlRouting,
): NuxtPage[] {
	const leftAlone = globMatcher(routing.unlocalizedPaths);
	const localized = pages.filter((page) => !leftAlone(page.path));
	return locales.flatMap((locale, index) => {
		const words = (path: string) => inWords(path, routing, index);
		if (routing.localePrefix === "always" || locale !== baseLocale) {
			const prefix = routing.prefixes[index] ?? locale;
			return localized.map((page) =>
				localizedPage(page, locale, (path) => {
					const translated = words(path);
					return `/${prefix}${translated === "/" ? "" : translated}`;
				}),
			);
		}
		return localized
			.filter((page) => words(page.path) !== page.path)
			.map((page) => localizedPage(page, locale, words));
	});
}

/**
 * A page and its children in a locale: each absolute path as `pathOf` gives it, relative ones as
 * they are.
 */
function localizedPage(
	page: NuxtPage,
	locale: string,
	pathOf: (path: string) => string,
): NuxtPage {
	const localizedPath = (path: string) =>
		path.startsWith("/") ? pathOf(path) : path;
	const { name, alias, children } = page;
	return {
		...page,
		path: localizedPath(page.path),
		...(name === undefined ? {} : { name: `${name}${separator}${locale}` }),
		...(alias === undefined
			? {}
			: { alias: [alias].flat().map((path) => localizedPath(path)) }),
		...(children === undefined
			? {}
			: {
					children: children.map((child) =>
						localizedPage(child, locale, pathOf),
					),
				}),
	};
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
