import type { NuxtPage } from "nuxt/schema";

/** What joins a page's name and its locale in a copy's name, as @nuxtjs/i18n names its copies. */
const separator = "___";

/**
 * The pages again under each locale's prefix, but the base locale's, which has none: the paths
 * the `url` strategy reads (`/ro/about`), routed to the same pages. A copy's name is its page's
 * with its locale, so every route's name stays unique, and a name still leads to the base
 * locale's page.
 */
export function localizedPages(
	pages: readonly NuxtPage[],
	locales: readonly string[],
	baseLocale: string,
): NuxtPage[] {
	return locales
		.filter((locale) => locale !== baseLocale)
		.flatMap((locale) => pages.map((page) => localizedPage(page, locale)));
}

/** A page and its children in a locale: each absolute path prefixed, relative ones as they are. */
function localizedPage(page: NuxtPage, locale: string): NuxtPage {
	const prefixed = (path: string) =>
		path.startsWith("/") ? `/${locale}${path === "/" ? "" : path}` : path;
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
			: { children: children.map((child) => localizedPage(child, locale)) }),
	};
}
