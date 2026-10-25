// The runtime every compiled message calls. The compiler copies this file into the output as it
// is, beside the config.js it writes with the project's locales.
import {
	baseLocale,
	cookieAttributes,
	cookieName,
	cookieSecure,
	customPrefixes,
	directions,
	leavesPathsAlone,
	locales,
	localStorageKey,
	prefixes,
	prefixesEveryLocale,
	readsUrl,
	strategy,
	unlocalizedPaths,
} from "./config.js";

export { baseLocale, locales };

// Each of the url strategy's options is a constant in config.js, which a bundler folds, so the code
// an option needs is checked by its constant where it runs, and a page carries none of it for an
// option its config does not use.

/**
 * The locale a path segment is the prefix of, if it is one: a locale's tag, or the segment the
 * config gives it, and never the base locale's unless every locale's paths are prefixed.
 */
const localeOfPrefix = (/** @type {string | undefined} */ segment) => {
	const locale = customPrefixes
		? locales[prefixes.indexOf(segment ?? "")]
		: segment;
	return isPrefixed(locale) ? locale : undefined;
};
/** Whether a value is a locale whose paths have a prefix. */
const isPrefixed = (/** @type {unknown} */ locale) =>
	isLocale(locale) && (prefixesEveryLocale || locale !== baseLocale);
/** Whether a path is one the `url` strategy leaves alone, which never has a prefix. */
const leftAlone = (/** @type {string} */ pathname) =>
	unlocalizedPaths.some((pattern) => pattern.test(pathname));

/**
 * @typedef {"locale-unknown" | "locale-not-loaded" | "value-unmatched" | "format-option-invalid" | "locale-unbound"} GraiErrorCode
 */

/** A message called in a locale it cannot render in, or with a value its variants do not take. */
export class GraiError extends Error {
	/** @override */
	name = "GraiError";
	/** @type {GraiErrorCode} */
	code;

	/**
	 * @param {GraiErrorCode} code
	 * @param {string} message
	 */
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * Whether this runs in a page. A page renders in its own locale alone: a production build loads
 * no other locale's messages, and every build keeps that rule, so nothing fails only after deploy.
 */
const page = typeof document !== "undefined";

/**
 * The locale outside a request, by its position in `locales`: in a browser, the page's
 * `<html lang>`, the locale the server drew it in; in a script or a test, the base locale.
 */
let current = locales.indexOf(
	page && locales.includes(document.documentElement.lang)
		? document.documentElement.lang
		: baseLocale,
);

/**
 * A request's locale, by its position in `locales`. The middleware binds one per request, and
 * `setLocale` in the request changes it in place: Workers have no `enterWith` to bind another,
 * and Node marks it experimental.
 *
 * @typedef {{ index: number }} RequestLocale
 */

/**
 * Where the server keeps each request's locale, set by server.js.
 *
 * @type {{ getStore(): RequestLocale | undefined } | undefined}
 */
let requests;

/**
 * Lets server.js bind each request's locale. Not for apps: they bind it through the middleware.
 *
 * @param {{ getStore(): RequestLocale | undefined }} storage
 */
export function bindRequests(storage) {
	requests = storage;
}

/** The position in `locales` of the bound locale: the request's, else the one outside a request. */
function bound() {
	return requests?.getStore()?.index ?? current;
}

/**
 * Binds a locale outside a request, by its position in `locales`: for the process, or the page.
 * testing.js binds a test's locale with it.
 *
 * @param {number} index
 */
export function bindLocale(index) {
	current = index;
}

/** @returns {string} */
export function getLocale() {
	return locales[bound()] ?? baseLocale;
}

/**
 * Sets the locale. In a request, for the rest of the request; in a script or a test, for the
 * process. In a browser, for the page: it sets the page's `<html lang>` and `dir`, so the document
 * and its messages never disagree, keeps the locale where the strategy reads it (its cookie, its
 * key in localStorage, or its URL) and reloads, unless `{ reload: false }`, after which only the
 * messages called next are in the new locale. The page's own locale is kept, but loads nothing
 * again.
 *
 * @param {string} locale
 * @param {{ reload?: boolean }} [options]
 */
export function setLocale(locale, options) {
	const index = locales.indexOf(assertIsLocale(locale));
	const request = requests?.getStore();
	if (request !== undefined) {
		request.index = index;
		return;
	}
	const changed = index !== current;
	current = index;
	if (!page) return;
	document.documentElement.lang = locale;
	document.documentElement.dir = directions[index] ?? "ltr";
	if (strategy.includes("cookie")) {
		// A browser drops a Secure cookie an http page sets, so it is Secure on https, and always
		// where its policy needs it.
		const secure =
			cookieSecure === "always" || location.protocol === "https:"
				? "; secure"
				: "";
		// biome-ignore lint/suspicious/noDocumentCookie: the reload that follows must see it, and the Cookie Store API is asynchronous and not in every browser.
		document.cookie = `${cookieName}=${locale}${cookieAttributes}${secure}`;
	}
	// The config names the key exactly when its strategy lists `localStorage`.
	if (localStorageKey !== undefined)
		localStorage.setItem(localStorageKey, locale);
	if (!changed || options?.reload === false) return;
	if (readsUrl) {
		location.href = localizeUrl(location.href, { locale }).href;
	} else {
		location.reload();
	}
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isLocale(value) {
	return typeof value === "string" && locales.includes(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function assertIsLocale(value) {
	if (typeof value === "string" && locales.includes(value)) return value;
	throw unknownLocale(value);
}

/** @param {unknown} value */
function unknownLocale(value) {
	return new GraiError(
		"locale-unknown",
		`${JSON.stringify(value)} is not one of the project's locales: ${locales.join(", ")}.`,
	);
}

/**
 * The direction a locale's script is written in, the bound locale's by default.
 *
 * @param {string} [locale]
 * @returns {"ltr" | "rtl"}
 */
export function getTextDirection(locale) {
	const index =
		locale === undefined ? bound() : locales.indexOf(assertIsLocale(locale));
	return directions[index] ?? "ltr";
}

/**
 * The locale a URL names: its first path segment when that is a locale's prefix, else the base
 * locale, whose paths have no prefix unless every locale's do. Without the `url` strategy no URL
 * names one: the base locale.
 *
 * @param {string | URL} url
 * @returns {string}
 */
export function extractLocaleFromUrl(url) {
	return localeOfPath(new URL(url).pathname) ?? baseLocale;
}

/**
 * The locale a URL's path names for the `url` strategy: its prefix's, else the base locale's,
 * unless every locale's paths are prefixed, when a path without one names none. A path the strategy
 * leaves alone names none either.
 *
 * @param {string} pathname
 * @returns {string | undefined}
 */
export function localeOfPath(pathname) {
	if (!readsUrl || (leavesPathsAlone && leftAlone(pathname))) return undefined;
	const named = localeOfPrefix(pathname.split("/")[1]);
	if (named !== undefined) return named;
	return prefixesEveryLocale ? undefined : baseLocale;
}

/**
 * A URL without its locale prefix. Without the `url` strategy a URL has none, and stays as it is.
 *
 * @param {string | URL} url
 * @returns {URL}
 */
export function deLocalizeUrl(url) {
	const copy = new URL(url);
	const [, first, ...rest] = copy.pathname.split("/");
	if (readsUrl && localeOfPrefix(first) !== undefined) {
		copy.pathname = `/${rest.join("/")}`;
	}
	return copy;
}

/**
 * A URL with a locale's prefix: the current locale's, unless `options.locale` names another.
 * Without the `url` strategy no URL takes one, and it stays as it is.
 *
 * @param {string | URL} url
 * @param {{ locale?: string }} [options]
 * @returns {URL}
 */
export function localizeUrl(url, options) {
	const locale = options?.locale ?? getLocale();
	const copy = deLocalizeUrl(url);
	if (
		readsUrl &&
		(prefixesEveryLocale || locale !== baseLocale) &&
		!(leavesPathsAlone && leftAlone(copy.pathname))
	) {
		// The home page is /de, not /de/: SvelteKit and Next drop a trailing slash by default, and
		// redirect to drop it.
		const path = copy.pathname === "/" ? "" : copy.pathname;
		const prefix = customPrefixes
			? (prefixes[locales.indexOf(locale)] ?? locale)
			: locale;
		copy.pathname = `/${prefix}${path}`;
	}
	return copy;
}

/**
 * A path such as `/cart?step=2` with a locale's prefix, under the `url` strategy. Any other href,
 * and every href without that strategy, is given back as it is.
 *
 * @param {string} href
 * @param {{ locale?: string }} [options]
 * @returns {string}
 */
export function localizeHref(href, options) {
	if (!href.startsWith("/") || href.startsWith("//")) return href;
	const url = localizeUrl(new URL(href, "http://localhost"), options);
	return url.pathname + url.search + url.hash;
}

/**
 * A message's variant for the locale a call renders in: the one it names, else the bound one. On
 * a page, a call names no locale but the page's.
 *
 * @template Variant
 * @param {readonly Variant[]} variants one per locale, in `locales` order; dev adds the key after
 * them, for the error to name
 * @param {{ locale?: string } | undefined} options
 * @returns {Variant}
 */
function variantFor(variants, options) {
	const locale = options?.locale;
	const index = locale === undefined ? bound() : locales.indexOf(locale);
	const variant = variants[index];
	if (variant === undefined || (page && index !== current))
		throw noVariant(variants, locale, index);
	return variant;
}

/**
 * Why a call has no variant: it names a locale the project does not have, or one the page does
 * not render in. A production page holds one locale's variants: the page's, unless its import map
 * gave it another's.
 *
 * @param {readonly unknown[]} variants
 * @param {unknown} locale
 * @param {number} index
 */
function noVariant(variants, locale, index) {
	if (index < 0) return unknownLocale(locale);
	const held =
		variants[current] === undefined
			? variants.findIndex((variant) => variant !== undefined)
			: current;
	return new GraiError(
		"locale-not-loaded",
		`${variants[locales.length] ?? "A message"} was called in "${locales[index]}", but this page renders in "${locales[held]}" alone.`,
	);
}

/**
 * A message with inputs: one function per locale, in `locales` order.
 *
 * @template Inputs, Result
 * @param {...(inputs: Inputs) => Result} variants
 * @returns {(inputs: Inputs, options?: { locale?: string }) => Result}
 */
export function message(...variants) {
	return (inputs, options) => variantFor(variants, options)(inputs);
}

/**
 * A message without inputs: one string per locale, in `locales` order.
 *
 * @param {...string} texts
 * @returns {(inputs?: unknown, options?: { locale?: string }) => string}
 */
export function text(...texts) {
	return (_inputs, options) => variantFor(texts, options);
}

/**
 * A message without inputs as the page's string, chosen once, when its module is evaluated: one
 * string per locale, in `locales` order. A page keeps its locale's words until it reloads, so a
 * component can read this string where it would call the message.
 *
 * @param {...string} texts
 * @returns {string}
 */
export function pageText(...texts) {
	return variantFor(texts, undefined);
}

/**
 * A message with markup: its text, and its parts for the app to draw the markup.
 *
 * @template Inputs, Part
 * @param {((inputs: Inputs) => string)[]} strings
 * @param {((inputs: Inputs) => Part[])[]} parts
 */
export function markup(strings, parts) {
	return Object.assign(message(...strings), { parts: message(...parts) });
}

/**
 * Throws for a value a closed select does not list; the message's input type excludes it.
 *
 * @param {string} key
 * @param {string} locale
 * @param {string} selector
 * @param {unknown} value
 * @returns {never}
 */
export function unmatched(key, locale, selector, value) {
	throw new GraiError(
		"value-unmatched",
		`"${key}" (${locale}) has no variant for ${selector}=${String(value)}. Pass one of the values its type lists.`,
	);
}

/** Intl.RelativeTimeFormat's units of time, each of which it also takes plural. */
const timeUnits = [
	"year",
	"quarter",
	"month",
	"week",
	"day",
	"hour",
	"minute",
	"second",
];

/**
 * @param {unknown} unit
 * @returns {unit is Intl.RelativeTimeFormatUnit}
 */
const isTimeUnit = (unit) =>
	typeof unit === "string" && timeUnits.includes(unit.replace(/s$/, ""));

/**
 * The unit of time an input gives a relative time, which Intl.RelativeTimeFormat takes with each
 * value. A value that is not one is the caller's mistake, and the error names it.
 *
 * @param {unknown} unit
 * @returns {Intl.RelativeTimeFormatUnit}
 */
export function timeUnit(unit) {
	if (isTimeUnit(unit)) return unit;
	throw new GraiError(
		"format-option-invalid",
		`An input gave unit ${JSON.stringify(unit)}, which is not a unit of time: ${timeUnits.join(", ")}, or one of them plural.`,
	);
}

/**
 * The formatter for a call with the value an input gives one of its options, such as its
 * currency: made the first time that value formats, and kept by it. A value Intl refuses is the
 * caller's mistake, and the error names it.
 *
 * @template {Intl.NumberFormat | Intl.DateTimeFormat} Made
 * @param {Map<unknown, Made>} made the formatters made, by the value
 * @param {new (locale: string, options: object) => Made} IntlFormat
 * @param {string} locale
 * @param {object} written the options the message writes
 * @param {string} option the option the input gives
 * @param {unknown} value
 * @returns {Made}
 */
export function formatterFor(made, IntlFormat, locale, written, option, value) {
	let formatter;
	try {
		formatter = new IntlFormat(locale, { ...written, [option]: value });
	} catch (error) {
		throw new GraiError(
			"format-option-invalid",
			`An input gave ${option} ${JSON.stringify(value)}, which Intl cannot format with in "${locale}": ${error instanceof Error ? error.message : String(error)}. Pass a currency's ISO 4217 code, a unit's name or an IANA time zone.`,
		);
	}
	made.set(value, formatter);
	return formatter;
}
