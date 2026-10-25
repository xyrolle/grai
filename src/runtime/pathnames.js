// Translating a URL's path between the app's route and a locale's words, for the config's
// `pathnames`. The compiler copies this file into the output for a config that has them, and
// config.js passes it their table.

/**
 * @typedef {{ pattern: RegExp, names: readonly string[], path: string }} PathForm
 * @typedef {{ route: PathForm, locales: readonly PathForm[] }} Pathname
 */

/**
 * The two translations of the pathnames, by a locale's position in `locales`: a path in the
 * locale's words to its route (`/ueber-uns` to `/about`), and a route to the locale's words. A path
 * no pathname matches is given back as it is.
 *
 * @param {readonly Pathname[]} pathnames
 */
export function pathTranslator(pathnames) {
	return {
		/** @type {(pathname: string, locale: number) => string} */
		routePath: (pathname, locale) =>
			translated(pathnames, pathname, (entry) => [
				entry.locales[locale],
				entry.route,
			]),
		/** @type {(pathname: string, locale: number) => string} */
		localePath: (pathname, locale) =>
			translated(pathnames, pathname, (entry) => [
				entry.route,
				entry.locales[locale],
			]),
	};
}

/**
 * The path filled in from the first pathname whose form the path matches.
 *
 * @param {readonly Pathname[]} pathnames
 * @param {string} pathname
 * @param {(entry: Pathname) => [PathForm | undefined, PathForm | undefined]} forms
 */
function translated(pathnames, pathname, forms) {
	for (const entry of pathnames) {
		const [from, to] = forms(entry);
		if (from === undefined || to === undefined) continue;
		const match = from.pattern.exec(pathname);
		if (match === null) continue;
		return to.path.replace(
			/\[([^\]]+)\]/g,
			(_, name) => match[from.names.indexOf(name) + 1] ?? "",
		);
	}
	return pathname;
}
