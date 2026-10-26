/**
 * The Intl formatters a format shows its value through, and what sets each apart: the value it
 * takes, and Intl.RelativeTimeFormat's unit, which it takes with each value rather than when it
 * is made, as the message writes it or as an input gives it.
 */

import { type IntlOptions, timeUnits } from "./format-functions.ts";
import type { Format } from "./format-options.ts";

function isRelativeTimeUnit(
	unit: IntlOptions[string] | undefined,
): unit is Intl.RelativeTimeFormatUnit {
	return typeof unit === "string" && timeUnits.has(unit);
}

/** A format's options split into those its formatter is made with, and its unit if it has one. */
function splitUnit(format: Format): {
	options: IntlOptions;
	unit: Intl.RelativeTimeFormatUnit | undefined;
} {
	if (format.formatter !== "relativetime") {
		return { options: format.options, unit: undefined };
	}
	const { unit, ...options } = format.options;
	if (unit === undefined && format.input?.option === "unit") {
		return { options, unit: undefined };
	}
	if (!isRelativeTimeUnit(unit)) {
		throw new Error(
			`a relative time needs a unit of time, not ${String(unit)}`,
		);
	}
	return { options, unit };
}

/**
 * The digits a rounding number selector reads a value as, with the options Intl shows them with:
 * in Latin digits, so plural rules can read them, without a percent's sign. The compile checks a
 * key with it, and `digitsCode` writes the same for formats.js.
 */
export function shownDigits(options: IntlOptions, value: number): string {
	const text = new Intl.NumberFormat("en", options).format(value);
	return options.style === "percent" ? text.replace("%", "") : text;
}

/** formats.js's function that gives a value's digits as `shownDigits` does. */
export function digitsCode(name: string, options: IntlOptions): string {
	const made = `${name}_made`;
	const percent = options.style === "percent" ? '.replace("%", "")' : "";
	return `/** @type {Intl.NumberFormat | undefined} */
let ${made};
/** @param {unknown} value */
export const ${name} = (value) =>
	(${made} ??= new Intl.NumberFormat("en", ${JSON.stringify(options)})).format(Number(value))${percent};
`;
}

/**
 * The formats Intl took, by formatter and options, the one checked last at the end. A catalog
 * repeats the same few formats over and over, and each locale's message repeats its base's, so
 * nearly every check is of options checked a moment ago. Several, not the last of each formatter:
 * a catalog that alternates a decimal format and a currency one, both Intl.NumberFormat, made its
 * formatter again at nearly every key, and kept, its compile of 13,000 keys × 3 went from 390 to
 * 321 ms. At most `takenLimit`, so a long compiler process keeps a
 * few strings, not every format it ever met, and no Intl formatter. Only options Intl took are
 * kept: refused ones are checked, and refused, each time they come.
 */
const taken = new Set<string>();
const takenLimit = 32;

/** Makes a format's formatter once, as formats.js does, so a value Intl refuses throws now. */
export function checkFormat(format: Format): void {
	const { options } = splitUnit(format);
	const signature = `${format.formatter} ${JSON.stringify(options)}`;
	if (taken.delete(signature)) {
		taken.add(signature);
		return;
	}
	makeFormatter(format.formatter, options);
	taken.add(signature);
	if (taken.size > takenLimit) {
		const [oldest] = taken;
		if (oldest !== undefined) taken.delete(oldest);
	}
}

function makeFormatter(
	formatter: Format["formatter"],
	options: IntlOptions,
): void {
	switch (formatter) {
		case "number":
			new Intl.NumberFormat(undefined, options);
			return;
		case "datetime":
			new Intl.DateTimeFormat(undefined, options);
			return;
		case "relativetime":
			new Intl.RelativeTimeFormat(undefined, options);
			return;
		case "list":
			new Intl.ListFormat(undefined, options);
			return;
	}
}

const constructors: Readonly<Record<Format["formatter"], string>> = {
	number: "Intl.NumberFormat",
	datetime: "Intl.DateTimeFormat",
	relativetime: "Intl.RelativeTimeFormat",
	list: "Intl.ListFormat",
};

/** What a format's formatter imports from the runtime. */
export function runtimeImports(format: Format): string[] {
	if (format.input === undefined) return [];
	return [format.formatter === "relativetime" ? "timeUnit" : "formatterFor"];
}

/**
 * A formatter as formats.js exports it: a function of the value, which makes its Intl formatter
 * the first time it formats. A number or a date is taken as a number, as Intl takes a date by its
 * time value, and a list as its items' text. With an option an input gives, it is a function of
 * that option's value too: a relative time's unit, which Intl takes with each value, checked as
 * one of time (`timeUnit` in the runtime), and any other option by a formatter for each value,
 * made the first time it formats.
 */
export function formatterCode(
	name: string,
	locale: string,
	format: Format,
): string {
	const { input } = format;
	if (input !== undefined && format.formatter !== "relativetime") {
		return inputFormatterCode(name, locale, format, input.option);
	}
	const { options, unit } = splitUnit(format);
	const made = `${name}_made`;
	const intl = constructors[format.formatter];
	const madeWith =
		Object.keys(options).length === 0 ? "" : `, ${JSON.stringify(options)}`;
	const value =
		format.formatter === "list"
			? "Array.isArray(value) ? value.map(String) : [String(value)]"
			: "Number(value)";
	const parameters = input === undefined ? ["value"] : ["value", input.option];
	const argument =
		input !== undefined
			? `, timeUnit(${input.option})`
			: unit === undefined
				? ""
				: `, ${JSON.stringify(unit)}`;
	return `/** @type {${intl} | undefined} */
let ${made};
${parametersDoc(parameters)}
export const ${name} = (${parameters.join(", ")}) =>
	(${made} ??= new ${intl}(${JSON.stringify(locale)}${madeWith})).format(${value}${argument});
`;
}

/**
 * A formatter one of whose options an input gives, which only a number's or a date's can: an Intl
 * formatter for each value of the option, kept by it (`formatterFor` in the runtime).
 */
function inputFormatterCode(
	name: string,
	locale: string,
	format: Format,
	option: string,
): string {
	const made = `${name}_made`;
	const intl = constructors[format.formatter];
	return `/** @type {Map<unknown, ${intl}>} */
const ${made} = new Map();
${parametersDoc(["value", option])}
export const ${name} = (value, ${option}) =>
	(
		${made}.get(${option}) ??
		formatterFor(${made}, ${intl}, ${JSON.stringify(locale)}, ${JSON.stringify(format.options)}, "${option}", ${option})
	).format(Number(value));
`;
}

/** A formatter's JSDoc, which types each of its parameters as unknown, as a call passes any input. */
function parametersDoc(parameters: readonly string[]): string {
	const lines = parameters.map((parameter) => `@param {unknown} ${parameter}`);
	return lines.length === 1
		? `/** ${lines[0]} */`
		: `/**\n${lines.map((line) => ` * ${line}`).join("\n")}\n */`;
}
