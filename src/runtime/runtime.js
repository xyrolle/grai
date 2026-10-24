// The runtime every compiled message calls. The compiler copies this file into the output as it
// is, beside the config.js it writes with the project's locales.
import { baseLocale, locales } from "./config.js";

export { baseLocale, locales };

/** A message called with an unknown locale, or with a value none of its variants accepts. */
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
 * A message's variant for the locale a call renders in: the one it names, else the base locale.
 *
 * @template Variant
 * @param {readonly Variant[]} variants one per locale, in `locales` order
 * @param {{ locale?: string } | undefined} options
 * @returns {Variant}
 */
function variantFor(variants, options) {
	const locale = options?.locale ?? baseLocale;
	const variant = variants[locales.indexOf(locale)];
	if (variant === undefined) throw unknownLocale(locale);
	return variant;
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
