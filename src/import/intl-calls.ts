/**
 * The MessageFormat 2 call that formats as Intl does with given options, for an importer that
 * reads a library's formats as Intl options: each call checked as the compiler reads it, so an
 * option grai does not take leaves the message out with the compiler's reason.
 */

import { functions, shapesText } from "../format-functions.ts";
import { parseCall } from "../format-options.ts";

/** Intl options by name, each value as a call writes it. */
export type IntlOptions = ReadonlyMap<string, string>;

/** A call of a function with options, checked as the compiler reads it. */
export function call(
	fn: string,
	options: IntlOptions,
	written: string,
): string {
	const text = [...options].map(([key, value]) => ` ${key}=${value}`).join("");
	parseCall(fn, text, written);
	return `:${fn}${text}`;
}

/** The function each of Intl.NumberFormat's styles has. */
const styleFunctions: Readonly<Record<string, string>> = {
	currency: "currency",
	percent: "percent",
	unit: "unit",
};

/**
 * A number as the function its style has, `:currency`, `:percent` or `:unit`, when every option it
 * is given is one that function takes; a currency's matching minimum and maximum fraction digits
 * are its fractionDigits. Else, and for a plain number, `:number` with the options as they are.
 */
export function numberCall(options: IntlOptions, written: string): string {
	const style = options.get("style");
	const fn = style === undefined ? undefined : styleFunctions[style];
	if (fn === undefined) return call("number", options, written);
	const own = new Map(options);
	own.delete("style");
	const minimum = own.get("minimumFractionDigits");
	if (
		fn === "currency" &&
		minimum !== undefined &&
		minimum === own.get("maximumFractionDigits")
	) {
		own.delete("minimumFractionDigits");
		own.delete("maximumFractionDigits");
		own.set("fractionDigits", minimum);
	}
	const taken = [...own.keys()].every((key) =>
		Object.hasOwn(functions[fn]?.options ?? {}, key),
	);
	return taken ? call(fn, own, written) : call("number", options, written);
}

/**
 * A date as `:datetime` with the options; given none that chooses the fields, as Intl's default,
 * a numeric date.
 */
export function dateCall(options: IntlOptions, written: string): string {
	if ([...options.keys()].some(shapesText)) {
		return call("datetime", options, written);
	}
	const fields: [string, string][] = [
		["year", "numeric"],
		["month", "numeric"],
		["day", "numeric"],
	];
	return call("date", new Map([...fields, ...options]), written);
}
