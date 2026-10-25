/**
 * ICU's skeletons, `{price, number, ::currency/EUR .00}` and `{when, date, ::yMMMd}`, as the Intl
 * options intl-messageformat reads them into, then as the MessageFormat 2 call that formats alike.
 * A stem or a field Intl has no option for leaves the message out, with the reason.
 */

import { MessageProblem } from "../problem.ts";
import { dateCall, numberCall } from "./intl-calls.ts";

type Options = Map<string, string>;

/** A number skeleton's call, such as `:currency currency=EUR fractionDigits=2`. */
export function numberSkeletonCall(skeleton: string, written: string): string {
	const options: Options = new Map();
	for (const token of skeleton.split(/\s+/).filter(Boolean)) {
		const [stem = "", ...settings] = token.split("/");
		if (!readStem(stem, settings, options)) {
			throw new MessageProblem(
				"unsupported",
				`${written} uses the skeleton stem ${token}, which grai import does not convert. Write the call with the Intl options it needs.`,
			);
		}
	}
	return numberCall(options, written);
}

/** Stems that are one setting, in their long and short spellings. */
const settingStems: Readonly<Record<string, readonly [string, string][]>> = {
	percent: [["style", "percent"]],
	"%": [["style", "percent"]],
	"group-off": [["useGrouping", "never"]],
	",_": [["useGrouping", "never"]],
	"precision-integer": [["maximumFractionDigits", "0"]],
	".": [["maximumFractionDigits", "0"]],
	"compact-short": [
		["notation", "compact"],
		["compactDisplay", "short"],
	],
	K: [
		["notation", "compact"],
		["compactDisplay", "short"],
	],
	"compact-long": [
		["notation", "compact"],
		["compactDisplay", "long"],
	],
	KK: [
		["notation", "compact"],
		["compactDisplay", "long"],
	],
	"notation-simple": [["notation", "standard"]],
	scientific: [["notation", "scientific"]],
	engineering: [["notation", "engineering"]],
	"unit-width-narrow": [
		["currencyDisplay", "narrowSymbol"],
		["unitDisplay", "narrow"],
	],
	"unit-width-short": [
		["currencyDisplay", "code"],
		["unitDisplay", "short"],
	],
	"unit-width-full-name": [
		["currencyDisplay", "name"],
		["unitDisplay", "long"],
	],
	"unit-width-iso-code": [["currencyDisplay", "symbol"]],
	"rounding-mode-floor": [["roundingMode", "floor"]],
	"rounding-mode-ceiling": [["roundingMode", "ceil"]],
	"rounding-mode-down": [["roundingMode", "trunc"]],
	"rounding-mode-up": [["roundingMode", "expand"]],
	"rounding-mode-half-even": [["roundingMode", "halfEven"]],
	"rounding-mode-half-down": [["roundingMode", "halfTrunc"]],
	"rounding-mode-half-up": [["roundingMode", "halfExpand"]],
	"sign-auto": [["signDisplay", "auto"]],
	"sign-always": [["signDisplay", "always"]],
	"+!": [["signDisplay", "always"]],
	"sign-never": [["signDisplay", "never"]],
	"+_": [["signDisplay", "never"]],
	"sign-except-zero": [["signDisplay", "exceptZero"]],
	"+?": [["signDisplay", "exceptZero"]],
	"sign-accounting": [["currencySign", "accounting"]],
	"()": [["currencySign", "accounting"]],
	"sign-accounting-always": [
		["signDisplay", "always"],
		["currencySign", "accounting"],
	],
	"()!": [
		["signDisplay", "always"],
		["currencySign", "accounting"],
	],
	"sign-accounting-except-zero": [
		["signDisplay", "exceptZero"],
		["currencySign", "accounting"],
	],
	"()?": [
		["signDisplay", "exceptZero"],
		["currencySign", "accounting"],
	],
};

const fractionPrecision = /^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/;
const significantPrecision = /^(@+)(\+|#+)?$/;
const integerWidth = /^0+$/;

/** Reads one stem into the options; false for a stem Intl has no option for. */
function readStem(
	stem: string,
	settings: readonly string[],
	options: Options,
): boolean {
	const setting = settingStems[stem];
	if (setting !== undefined && settings.length === 0) {
		for (const [key, value] of setting) options.set(key, value);
		return true;
	}
	const [first, ...more] = settings;
	if (
		(stem === "currency" || stem === "unit" || stem === "measure-unit") &&
		first !== undefined &&
		more.length === 0
	) {
		if (stem === "currency")
			options.set("style", "currency").set("currency", first);
		else options.set("style", "unit").set("unit", first.replace(/^.*?-/, ""));
		return true;
	}
	if (integerWidth.test(stem) && settings.length === 0) {
		options.set("minimumIntegerDigits", String(stem.length));
		return true;
	}
	const fraction = fractionPrecision.exec(stem);
	if (fraction !== null && more.length === 0) {
		readFraction(fraction, options);
		if (first === "w") options.set("trailingZeroDisplay", "stripIfInteger");
		else if (first !== undefined && !readSignificant(first, options))
			return false;
		return true;
	}
	return settings.length === 0 && readSignificant(stem, options);
}

function readFraction(match: RegExpExecArray, options: Options): void {
	const [, zeros, star, hashes, zerosBefore, hashesAfter] = match;
	if (star !== undefined && zeros !== undefined) {
		options.set("minimumFractionDigits", String(zeros.length));
	} else if (hashes !== undefined) {
		options.set("maximumFractionDigits", String(hashes.length));
	} else if (zerosBefore !== undefined && hashesAfter !== undefined) {
		options.set("minimumFractionDigits", String(zerosBefore.length));
		options.set(
			"maximumFractionDigits",
			String(zerosBefore.length + hashesAfter.length),
		);
	} else if (zeros !== undefined) {
		options.set("minimumFractionDigits", String(zeros.length));
		options.set("maximumFractionDigits", String(zeros.length));
	}
}

/** Reads `@@`, `@@#` or `@+` as significant digits; false for anything else. */
function readSignificant(text: string, options: Options): boolean {
	const match = significantPrecision.exec(text);
	if (match === null) return false;
	const [, at = "", rest] = match;
	options.set("minimumSignificantDigits", String(at.length));
	if (rest === undefined)
		options.set("maximumSignificantDigits", String(at.length));
	else if (rest !== "+") {
		options.set("maximumSignificantDigits", String(at.length + rest.length));
	}
	return true;
}

/** A date skeleton's field letters, as intl-messageformat reads them. */
const dateField =
	/G{1,5}|y+|[ML]{1,5}|d{1,2}|E{1,6}|[ec]{4,6}|a|[hHkK]{1,2}|m{1,2}|s{1,2}|z{1,4}|[A-Za-z]/g;

/** A date skeleton's call, such as `:datetime year=numeric month=short day=numeric`. */
export function dateSkeletonCall(skeleton: string, written: string): string {
	const options: Options = new Map();
	for (const [field] of skeleton.matchAll(dateField)) {
		if (!readField(field, options)) {
			throw new MessageProblem(
				"unsupported",
				`${written} uses the date field ${field}, which grai import does not convert. Write the call with the Intl options it needs.`,
			);
		}
	}
	return dateCall(options, written);
}

const widths = ["numeric", "2-digit"];
const textWidths = ["numeric", "2-digit", "short", "long", "narrow"];
/** The fields a letter writes as a number or two digits. */
const numericFields: Readonly<Record<string, string>> = {
	d: "day",
	m: "minute",
	s: "second",
};
const hourCycles: Readonly<Record<string, string>> = {
	h: "h12",
	H: "h23",
	K: "h11",
	k: "h24",
};

/** Reads one date field into the options; false for a field Intl has no option for. */
function readField(field: string, options: Options): boolean {
	const letter = field.charAt(0);
	const length = field.length;
	const named = (long: number) =>
		length === long ? "long" : length === long + 1 ? "narrow" : "short";
	switch (letter) {
		case "G":
			options.set("era", named(4));
			return true;
		case "y":
			options.set("year", length === 2 ? "2-digit" : "numeric");
			return true;
		case "M":
		case "L":
			options.set("month", textWidths[length - 1] ?? "numeric");
			return true;
		case "E":
			options.set("weekday", named(4));
			return true;
		case "e":
		case "c":
			if (length < 4) return false;
			options.set(
				"weekday",
				["long", "narrow", "short"][length - 4] ?? "short",
			);
			return true;
		case "a":
			options.set("hour12", "true");
			return true;
		case "z":
			options.set("timeZoneName", length < 4 ? "short" : "long");
			return true;
	}
	const numeric = numericFields[letter];
	if (numeric !== undefined) {
		options.set(numeric, widths[length - 1] ?? "numeric");
		return true;
	}
	const cycle = hourCycles[letter];
	if (cycle === undefined) return false;
	options.set("hourCycle", cycle).set("hour", widths[length - 1] ?? "numeric");
	return true;
}
