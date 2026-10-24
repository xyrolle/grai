// The runtime every compiled message calls. The compiler copies this file into the output as it
// is, beside the config.js it writes with the project's locales.
import {
	baseLocale,
	cookieName,
	directions,
	locales,
	strategy,
} from "./config.js";

export { baseLocale, cookieName, locales };

/** A message called in a locale it cannot render in, or with a value its variants do not take. */
export class GraiError extends Error {
	/** @override */
	name = "GraiError";
	/** @type {string} */
	code;

	/**
	 * @param {string} code
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
 * Where the server keeps each request's locale, set by server.js.
 *
 * @type {{ getStore(): number | undefined, enterWith(index: number): void } | undefined}
 */
let requests;

/**
 * Lets server.js bind each request's locale. Not for apps: they bind it through the middleware.
 *
 * @param {{ getStore(): number | undefined, enterWith(index: number): void }} storage
 */
export function bindRequests(storage) {
	requests = storage;
}

/** The position in `locales` of the bound locale: the request's, else the one outside a request. */
function bound() {
	return requests?.getStore() ?? current;
}

/** @returns {string} */
export function getLocale() {
	return locales[bound()] ?? baseLocale;
}

/**
 * Sets the locale. In a request, for the rest of the request; in a script or a test, for the
 * process. In a browser, for the page: it keeps the locale where the server reads it (its cookie,
 * or its URL) and reloads, unless `{ reload: false }`, after which only the messages called next
 * are in the new locale.
 *
 * @param {string} locale
 * @param {{ reload?: boolean }} [options]
 */
export function setLocale(locale, options) {
	const index = locales.indexOf(assertIsLocale(locale));
	if (requests?.getStore() !== undefined) return requests.enterWith(index);
	current = index;
	if (!page) return;
	document.documentElement.lang = locale;
	if (strategy.includes("cookie")) {
		// biome-ignore lint/suspicious/noDocumentCookie: the reload that follows must see it, and the Cookie Store API is asynchronous and not in every browser.
		document.cookie = `${cookieName}=${locale}; path=/; max-age=34560000; samesite=lax`;
	}
	if (options?.reload === false) return;
	if (strategy.includes("url")) {
		location.href = localizeUrl(location.href, { locale }).href;
	} else {
		location.reload();
	}
}

/**
 * @param {unknown} value
 * @returns {boolean}
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
 * The locale a URL names: its first path segment when that is a locale other than the base
 * locale, which has no prefix.
 *
 * @param {string | URL} url
 * @returns {string}
 */
export function extractLocaleFromUrl(url) {
	const first = new URL(url).pathname.split("/")[1];
	return first !== undefined && first !== baseLocale && isLocale(first)
		? first
		: baseLocale;
}

/**
 * A URL without its locale prefix.
 *
 * @param {string | URL} url
 * @returns {URL}
 */
export function deLocalizeUrl(url) {
	const copy = new URL(url);
	const [, first, ...rest] = copy.pathname.split("/");
	if (first !== baseLocale && isLocale(first)) {
		copy.pathname = `/${rest.join("/")}`;
	}
	return copy;
}

/**
 * A URL with a locale's prefix: the current locale's, unless `options.locale` names another.
 *
 * @param {string | URL} url
 * @param {{ locale?: string }} [options]
 * @returns {URL}
 */
export function localizeUrl(url, options) {
	const locale = options?.locale ?? getLocale();
	const copy = deLocalizeUrl(url);
	if (locale !== baseLocale) copy.pathname = `/${locale}${copy.pathname}`;
	return copy;
}

/**
 * A path such as `/cart?step=2` with a locale's prefix. Any other href is given back as it is.
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
