// The script that picks a page's locale when no server does: a static site, an Electron app, a
// browser extension. The Vite plugin writes this function's source into each page, as an inline
// classic script ahead of every module script, called with the project's settings and the server's
// language matching (`localeReach` in `server.js`). It runs before any module can, so it refers to
// nothing outside its own body and its arguments. The compiler does not copy it into the output.

/**
 * What the script takes from the project's config.
 *
 * @typedef {{
 *   locales: readonly string[],
 *   baseLocale: string,
 *   directions: readonly ("ltr" | "rtl")[],
 *   strategy: readonly ("cookie" | "localStorage" | "preferredLanguage" | "query" | "url")[],
 *   cookieName: string | undefined,
 *   localStorageKey: string | undefined,
 *   queryParameter: string | undefined,
 *   prefixes: readonly string[],
 *   prefixesEveryLocale: boolean,
 *   unlocalizedPaths: readonly { source: string, flags: string }[],
 * }} PageSettings
 */

/**
 * A page's message chunks and their copies, `{locale}` standing for the page's locale: the import
 * map's entries, and the copies the page's entry imports, to preload.
 *
 * @typedef {{ imports: Record<string, string>, preload: string[] }} PageChunks
 */

/**
 * Picks the page's locale, once, and sets `<html lang>` and `dir`, which the runtime reads when it
 * loads. A page whose `<html lang>` is one of the project's locales keeps it: a server drew it in
 * that locale. Otherwise the strategy's places are read in order: the choice the visitor stored
 * (`cookie`, `localStorage`), the URL (`query`, `url`) and the browser's languages
 * (`preferredLanguage`), each matched as the server matches it, else the base locale.
 *
 * In a build that copies each message chunk per locale, the script's `data-grai-chunks` names the
 * page's chunks, and it maps them to the locale's copies with an import map, before any module
 * loads, then preloads the copies the page's entry imports. It gives both its own nonce, for a page
 * whose Content Security Policy allows scripts by nonce.
 *
 * @param {PageSettings} settings
 * @param {(locales: readonly string[]) => (range: string) => string[]} localeReach
 */
export function pickPageLocale(settings, localeReach) {
	const { locales, baseLocale, strategy } = settings;
	const root = document.documentElement;
	const script = document.currentScript;
	const reach = localeReach(locales);
	/** @param {string} tag the nearest locale a tag reaches */
	const match = (tag) => reach(tag)[0];
	/** @param {string | null | undefined} value */
	const stored = (value) =>
		typeof value === "string" && locales.includes(value) ? value : undefined;
	/** @param {string | undefined} name */
	const fromCookie = (name) => {
		for (const cookie of document.cookie.split(";")) {
			const [key, value] = cookie.split("=").map((part) => part.trim());
			if (key === name) return stored(value);
		}
		return undefined;
	};
	/** @param {string | undefined} key */
	const fromStorage = (key) => {
		if (key === undefined) return undefined;
		try {
			return stored(localStorage.getItem(key));
		} catch (error) {
			// A frame whose storage the browser withholds, sandboxed or with storage turned off,
			// holds no stored choice.
			if (!(error instanceof DOMException)) throw error;
			return undefined;
		}
	};
	/** @param {string | undefined} parameter */
	const fromQuery = (parameter) => {
		const tag =
			parameter === undefined
				? null
				: new URLSearchParams(location.search).get(parameter);
		return tag === null ? undefined : match(tag);
	};
	const fromLanguages = () => {
		for (const tag of navigator.languages) {
			const locale = match(tag);
			if (locale !== undefined) return locale;
		}
		return undefined;
	};
	// The url strategy's rule, as the runtime's localeOfPath has it: the locale whose prefix is the
	// path's first segment, where the base locale has one only when every locale's paths do. A path
	// without a prefix is the base locale's, or names none when every locale's paths have one, and
	// so does a path the strategy leaves alone.
	const fromPath = () => {
		const { pathname } = location;
		const left = settings.unlocalizedPaths.some(({ source, flags }) =>
			new RegExp(source, flags).test(pathname),
		);
		if (left) return undefined;
		const locale =
			locales[settings.prefixes.indexOf(pathname.split("/")[1] ?? "")];
		if (
			locale !== undefined &&
			(settings.prefixesEveryLocale || locale !== baseLocale)
		) {
			return locale;
		}
		return settings.prefixesEveryLocale ? undefined : baseLocale;
	};
	/** @param {PageSettings["strategy"][number]} source */
	const named = (source) => {
		switch (source) {
			case "cookie":
				return fromCookie(settings.cookieName);
			case "localStorage":
				return fromStorage(settings.localStorageKey);
			case "query":
				return fromQuery(settings.queryParameter);
			case "preferredLanguage":
				return fromLanguages();
			case "url":
				return fromPath();
		}
	};

	if (!locales.includes(root.lang)) {
		let locale = baseLocale;
		for (const source of strategy) {
			const found = named(source);
			if (found === undefined) continue;
			locale = found;
			break;
		}
		root.lang = locale;
		root.dir = settings.directions[locales.indexOf(locale)] ?? "ltr";
	}

	const chunks = script?.dataset.graiChunks;
	if (script === null || chunks === undefined) return;
	/** @type {PageChunks} */
	const copies = JSON.parse(chunks.replaceAll("{locale}", root.lang));
	const map = document.createElement("script");
	map.type = "importmap";
	map.nonce = script.nonce;
	map.textContent = JSON.stringify({ imports: copies.imports });
	document.head.append(map);
	for (const href of copies.preload) {
		const link = document.createElement("link");
		link.rel = "modulepreload";
		link.crossOrigin = "";
		link.nonce = script.nonce;
		link.href = href;
		document.head.append(link);
	}
}
