// The script that picks a page's locale when no server does: a static site, an Electron app, a
// browser extension. The Vite plugin writes these functions' sources into each page, as an inline
// classic script ahead of every module script: `pickPageLocale`, called with the project's settings
// and a reader of each place the config's strategy reads, made by its function here, with the
// server's language matching (`localeReach` in `server.js`) for those that match a language; then,
// in a build that copies the message chunks per locale, `pointAtCopies`. It runs before any module
// can, so each function refers to nothing outside its own body and its arguments. The compiler
// does not copy them into the output.

/**
 * What every page's script takes from the project's config.
 *
 * @typedef {{
 *   locales: readonly string[],
 *   baseLocale: string,
 *   directions: readonly ("ltr" | "rtl")[],
 * }} PageSettings
 */

/**
 * What the `url` strategy reads of the config: each locale's prefix, whether the base locale has
 * one, the base path, each locale's host, and the paths it leaves alone.
 *
 * @typedef {{
 *   prefixes: readonly string[],
 *   prefixesEveryLocale: boolean,
 *   basePath: string,
 *   domains: readonly string[],
 *   unlocalizedPaths: readonly { source: string, flags: string }[],
 * }} UrlSettings
 */

/**
 * The server's language matching, `localeReach` in `server.js`: the locales a range reaches.
 *
 * @typedef {(locales: readonly string[]) => (range: string) => string[]} LocaleReach
 */

/**
 * A page's message chunks and their copies, `{locale}` standing for the page's locale: the import
 * map's entries, and the copies the page's entry imports, to preload.
 *
 * @typedef {{ imports: Record<string, string>, preload: string[] }} PageChunks
 */

/**
 * Picks the page's locale, once, and sets `<html lang>` and `dir`, which the runtime reads when it
 * loads. The `<html lang>` a page is built with, which the script's `data-grai-lang` names, is only
 * its default; a page whose server or prerender wrote another of the project's locales in its place
 * keeps that one, as the page was drawn in it. Otherwise `readers` read the strategy's places in
 * its order, the first locale one names winning. Where none names a locale, the page keeps the one
 * it was built with, else takes the base locale.
 *
 * @param {PageSettings} settings
 * @param {readonly (() => string | undefined)[]} readers
 */
export function pickPageLocale({ locales, baseLocale, directions }, readers) {
	const root = document.documentElement;
	const drawn = locales.includes(root.lang) ? root.lang : undefined;
	if (drawn !== undefined && drawn !== document.currentScript?.dataset.graiLang)
		return;
	let locale = drawn ?? baseLocale;
	for (const read of readers) {
		const found = read();
		if (found === undefined) continue;
		locale = found;
		break;
	}
	root.lang = locale;
	root.dir = directions[locales.indexOf(locale)] ?? "ltr";
}

/**
 * In a build that copies each message chunk per locale, points the page at its locale's copies:
 * the script's `data-grai-chunks` names the page's chunks, which an import map maps to the copies
 * before any module loads, and the copies the page's entry imports are preloaded. In dev, it names
 * keys.js, which the map points at the dev module with the locale's words alone, preloaded. It
 * gives both the script's own nonce, for a page whose Content Security Policy allows scripts by
 * nonce.
 */
export function pointAtCopies() {
	const script = document.currentScript;
	const chunks = script?.dataset.graiChunks;
	if (script === null || chunks === undefined) return;
	/** @type {PageChunks} */
	const copies = JSON.parse(
		chunks.replaceAll("{locale}", document.documentElement.lang),
	);
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

// Each place a strategy reads in the page, as a function that makes its reader: what the visitor
// stored (`cookie`, `localStorage`), the URL (`query`, `url`) and the browser's languages
// (`preferredLanguage`), each matched as the server matches it. The script holds the readers of
// the config's strategy alone.

/**
 * The `cookie` strategy's place: the locale the cookie holds.
 *
 * @param {{ locales: readonly string[], cookieName: string | undefined }} settings
 */
export function cookieReader({ locales, cookieName }) {
	return () => {
		for (const cookie of document.cookie.split(";")) {
			const [key, value] = cookie.split("=").map((part) => part.trim());
			if (key === cookieName)
				return value !== undefined && locales.includes(value)
					? value
					: undefined;
		}
		return undefined;
	};
}

/**
 * The `localStorage` strategy's place: the locale stored under the key.
 *
 * @param {{ locales: readonly string[], localStorageKey: string | undefined }} settings
 */
export function storageReader({ locales, localStorageKey }) {
	return () => {
		if (localStorageKey === undefined) return undefined;
		try {
			const value = localStorage.getItem(localStorageKey);
			return value !== null && locales.includes(value) ? value : undefined;
		} catch (error) {
			// A frame whose storage the browser withholds, sandboxed or with storage turned off,
			// holds no stored choice.
			if (!(error instanceof DOMException)) throw error;
			return undefined;
		}
	};
}

/**
 * The `query` strategy's place: the nearest locale the query parameter's tag reaches.
 *
 * @param {{ locales: readonly string[], queryParameter: string | undefined }} settings
 * @param {LocaleReach} localeReach
 */
export function queryReader({ locales, queryParameter }, localeReach) {
	const reach = localeReach(locales);
	return () => {
		const tag =
			queryParameter === undefined
				? null
				: new URLSearchParams(location.search).get(queryParameter);
		return tag === null ? undefined : reach(tag)[0];
	};
}

/**
 * The `preferredLanguage` strategy's place: the nearest locale the first of the browser's
 * languages to reach one reaches.
 *
 * @param {{ locales: readonly string[] }} settings
 * @param {LocaleReach} localeReach
 */
export function languagesReader({ locales }, localeReach) {
	const reach = localeReach(locales);
	return () => {
		for (const tag of navigator.languages) {
			const locale = reach(tag)[0];
			if (locale !== undefined) return locale;
		}
		return undefined;
	};
}

/**
 * The `url` strategy's place, as the runtime's localeOfPath has it: the locale whose prefix is the
 * path's first segment, where the base locale has one only when every locale's paths do. A path
 * without a prefix is the base locale's, or names none when every locale's paths have one, and so
 * does a path the strategy leaves alone. The prefix follows the base path. On a locale's own host,
 * the host names the locale.
 *
 * @param {PageSettings & UrlSettings} settings
 */
export function pathReader(settings) {
	const { locales, baseLocale } = settings;
	return () => {
		const hosted = locales[settings.domains.indexOf(location.host)];
		if (hosted !== undefined) return hosted;
		const base = settings.basePath;
		const full = location.pathname;
		const pathname =
			base !== "" && (full === base || full.startsWith(`${base}/`))
				? full.slice(base.length) || "/"
				: full;
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
}
