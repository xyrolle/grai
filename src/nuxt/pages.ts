import type { NuxtPage } from "nuxt/schema";
import { globMatcher } from "../globs.ts";
import type { UrlRouting } from "../url-routing.ts";

/** What joins a page's name and its locale in a copy's name, as @nuxtjs/i18n names its copies. */
const separator = "___";

/**
 * The pages again under each prefixed locale's prefix: the paths the `url` strategy reads
 * (`/ro/about`), routed to the same pages. The base locale's paths have no prefix unless every
 * locale's do, and a page at a path the strategy leaves alone has no copies. A copy's name is its
 * page's with its locale, so every route's name stays unique, and a name still leads to the
 * unprefixed page.
 */
export function localizedPages(
	pages: readonly NuxtPage[],
	locales: readonly string[],
	baseLocale: string,
	routing: UrlRouting,
): NuxtPage[] {
	const leftAlone = globMatcher(routing.unlocalizedPaths);
	const localized = pages.filter((page) => !leftAlone(page.path));
	return locales.flatMap((locale, index) =>
		routing.localePrefix === "always" || locale !== baseLocale
			? localized.map((page) =>
					localizedPage(page, locale, routing.prefixes[index] ?? locale),
				)
			: [],
	);
}

/** A page and its children in a locale: each absolute path prefixed, relative ones as they are. */
function localizedPage(
	page: NuxtPage,
	locale: string,
	prefix: string,
): NuxtPage {
	const prefixed = (path: string) =>
		path.startsWith("/") ? `/${prefix}${path === "/" ? "" : path}` : path;
	const { name, alias, children } = page;
	return {
		...page,
		path: prefixed(page.path),
		...(name === undefined ? {} : { name: `${name}${separator}${locale}` }),
		...(alias === undefined
			? {}
			: { alias: [alias].flat().map((path) => prefixed(path)) }),
		...(children === undefined
			? {}
			: {
					children: children.map((child) =>
						localizedPage(child, locale, prefix),
					),
				}),
	};
}
