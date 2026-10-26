// The runtime every compiled message calls. The compiler copies this file into the output as it
// is, beside the config.js it writes with the project's locales.
import {
	baseLocale,
	cookieAttributes,
	cookieName,
	cookieSecure,
	customPrefixes,
	directions,
	keepsChoice,
	leavesPathsAlone,
	locales,
	localStorageKey,
	prefixes,
	prefixesEveryLocale,
	queryParameter,
	readsUrl,
	strategy,
	unlocalizedPaths,
} from "./config.js";

// What the rest of the output reads of the config, through the runtime's anchor: the runtime is the
// one module of the output that imports the config, so a process that holds one runtime holds one
// config.
export {
	cookieName,
	leavesPathsAlone,
	localeCopies,
	prefixesEveryLocale,
	queryParameter,
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
 * @typedef {"locale-unknown" | "locale-not-loaded" | "locale-unkept" | "value-unmatched" | "format-option-invalid" | "locale-unbound" | "output-changed"} GraiErrorCode
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
 * `<html lang>`, the locale the server drew it in; in a script or a test, the base locale, or the
 * one the test binds. A server reads it only once a test binds it.
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

/** Whether a test bound the locale outside a request, which then holds on a server too. */
let boundByTest = false;

/** The position in `locales` of the bound locale: the request's, else the one outside a request. */
function bound() {
	const request = requests?.getStore();
	if (request !== undefined) return request.index;
	if (requests !== undefined && !boundByTest) throw unbound();
	return current;
}

/**
 * Why a server's call outside every request it binds fails: there is no reader's locale there,
 * and the process's would render some readers' pages in another language. A stream's pull runs
 * there once the middleware has returned, as its reader starts it.
 */
function unbound() {
	return new GraiError(
		"locale-unbound",
		"A message was rendered outside every request the middleware binds. Render it while the handler runs, or in a task the handler starts: a stream renders in its start() or in a task writing to it, not in its pull(), which runs once the middleware has returned. Outside a request, pass { locale } to the message.",
	);
}

/**
 * Binds a locale outside a request, by its position in `locales`: for the process, or the page.
 * testing.js binds a test's locale with it, which holds on a server too.
 *
 * @param {number} index
 */
export function bindLocale(index) {
	current = index;
	boundByTest = true;
}

/** @returns {string} */
export function getLocale() {
	return locales[bound()] ?? baseLocale;
}

/**
 * Sets the locale. In a request, for the rest of the request; on a server outside every request,
 * it throws `locale-unbound`, unless a test bound one; in a script or a test, for the process. A
 * page renders in its locale for as long as it lives, so in a page it keeps the choice where the
 * strategy reads it: its cookie, its key in localStorage, its URL's prefix or query parameter.
 * Then it loads the page again in it, at the URL that names it, unless `{ reload: false }`, which
 * only keeps the choice, for the page's next load. A page whose strategy keeps the choice nowhere
 * would load in its old locale again, so there it throws. The page's own locale is kept too, but
 * loads nothing again.
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
	if (requests !== undefined && !boundByTest) throw unbound();
	if (!page) {
		current = index;
		return;
	}
	// The page's own locale loads nothing again: a picker that chooses its current value, or a
	// preference written again at start, keeps the page and its state.
	const changed = index !== current;
	if (changed && !keepsChoice) throw unkept(locale);
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
	// The next load must find the locale where the strategy reads a URL: a stale `?lng=` would
	// otherwise win over the choice.
	const next = readsUrl
		? localizeUrl(location.href, { locale })
		: new URL(location.href);
	if (queryParameter !== undefined) {
		next.searchParams.set(queryParameter, locale);
	}
	if (next.href === location.href) location.reload();
	else location.href = next.href;
}

/** @param {string} locale */
function unkept(locale) {
	return new GraiError(
		"locale-unkept",
		`setLocale(${JSON.stringify(locale)}) would load the page in its old locale again: "strategy" lists no place that keeps a choice, such as "cookie" or "localStorage".`,
	);
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
 * A URL without its locale prefix. Without the `url` strategy a URL has none, and stays as it is,
 * and so does a path the strategy leaves alone, though its first segment reads as a prefix.
 *
 * @param {string | URL} url
 * @returns {URL}
 */
export function deLocalizeUrl(url) {
	const copy = new URL(url);
	const [, first, ...rest] = copy.pathname.split("/");
	if (
		readsUrl &&
		localeOfPrefix(first) !== undefined &&
		!(leavesPathsAlone && leftAlone(copy.pathname))
	) {
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
export function variantFor(variants, options) {
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
 * The position in `locales` of the locale a call renders in: the one it names, else the bound one.
 * A server build's message dispatches on it in its own code.
 *
 * @param {{ locale?: string } | undefined} options
 * @returns {number}
 */
export function localeIndex(options) {
	const locale = options?.locale;
	if (locale === undefined) return bound();
	const index = locales.indexOf(locale);
	if (index < 0) throw unknownLocale(locale);
	return index;
}

/**
 * A message in a server build whose own code makes its dispatch: `make` of its variants.
 *
 * @template Variant, Dispatch
 * @param {(variants: readonly Variant[]) => Dispatch} make
 * @param {readonly Variant[]} variants
 * @returns {Dispatch}
 */
export function dispatcher(make, variants) {
	return make(variants);
}

/**
 * A message with markup whose own code makes its dispatches: of its text, with that of its parts
 * as `.parts`.
 *
 * @template {object} Dispatch
 * @template Parts
 * @param {Dispatch} dispatch
 * @param {Parts} parts
 */
export function withParts(dispatch, parts) {
	return Object.assign(dispatch, { parts });
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
 * Throws unless a module of the output's keys was compiled for the locales this runtime reads, at
 * their positions. They differ only when a compile changed the locales while a process loaded the
 * output, which then holds the keys of one compile and the runtime of another.
 *
 * @param {readonly string[]} compiled
 */
export function assertCompiledFor(compiled) {
	if (
		compiled.length === locales.length &&
		compiled.every((locale, index) => locale === locales[index])
	)
		return;
	throw new GraiError(
		"output-changed",
		`the output's keys were compiled for ${compiled.join(", ")}, but its runtime reads ${locales.join(", ")}: a compile changed the locales while this process loaded them. Load the output again, as by restarting the process.`,
	);
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
