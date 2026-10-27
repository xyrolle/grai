// keys.js as a dev server serves it: from memory, by an id of its own, every locale's words for a
// server, and by an id per locale for a page, which the page's import map points keys.js at, so a
// page loads its own locale's words alone. Plain strings, so an adapter writes a page's import map
// without the dev server's code.

/** keys.js's id in dev, every locale's words, as a server takes them. */
export const devKeysId = "\0grai:keys";

/** The id of keys.js with one locale's words alone, as a page in that locale takes them. */
export function pageKeysId(locale: string): string {
	return `${devKeysId}/${locale}`;
}

/** Whether an id is keys.js's in dev, every locale's or a page's. */
export function isDevKeys(id: string): boolean {
	return id === devKeysId || id.startsWith(`${devKeysId}/`);
}

/** The locale of a page's keys.js, by its id, if it is one of `locales`. */
export function pageKeysLocale(
	id: string,
	locales: readonly string[],
): string | undefined {
	const locale = id.slice(devKeysId.length + 1);
	return id === pageKeysId(locale) && locales.includes(locale)
		? locale
		: undefined;
}

/** keys.js's URL in dev under the dev server's `base`, as Vite writes a virtual module's. */
const keysUrl = (base: string) => `${base}@id/__x00__${devKeysId.slice(1)}`;

/** The URL of a page's keys.js in dev, with its locale's words alone. */
export function pageKeysUrl(base: string, locale: string): string {
	return `${keysUrl(base)}/${locale}`;
}

/** The import map's entry that points a dev page at its locale's keys.js, from keys.js's. */
export function pageKeysImports(
	base: string,
	locale: string,
): Record<string, string> {
	return { [keysUrl(base)]: pageKeysUrl(base, locale) };
}
