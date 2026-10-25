/**
 * i18next's built-in formats as the MessageFormat 2 calls that format alike: `number`, `currency`,
 * `datetime`, `relativetime` and `list`, with the Intl options i18next passes them. Each call is
 * checked as the compiler reads it, so an option grai does not take leaves the message out.
 */

import { functions, shapesText } from "../format-functions.ts";
import { parseCall } from "../format-options.ts";
import { ownEntry } from "../own-entry.ts";
import { MessageProblem } from "../problem.ts";

/** A format as i18next writes it, such as `currency(USD)` or `list(type: disjunction)`. */
const formatWritten = /^([a-z]+)(?:\((.*)\))?$/is;

/** The call that formats a value as i18next's format does, such as `:currency currency=EUR`. */
export function formatCall(format: string, written: string): string {
	const [, name = "", optionsText] = formatWritten.exec(format) ?? [];
	const kind = name.toLowerCase();
	const options = optionsOf(kind, optionsText);
	const convert = ownEntry(converters, kind);
	if (convert === undefined) {
		throw new MessageProblem(
			"unsupported",
			`${written} formats the value as ${format}, which grai import does not convert. Write it with one of grai's formatting functions.`,
		);
	}
	return convert(options, written);
}

type Options = ReadonlyMap<string, string>;

/**
 * A format's options. `currency(USD)` names the currency, and `relativetime(quarter)` the unit;
 * otherwise they are `name: value` pairs joined by `;`, a value maybe in single quotes.
 */
function optionsOf(kind: string, text: string | undefined): Options {
	if (text === undefined || text.trim() === "") return new Map();
	if (!text.includes(":")) {
		const single = kind === "currency" ? "currency" : "range";
		return new Map([[single, text.trim()]]);
	}
	return new Map(
		text
			.split(";")
			.filter((pair) => pair.trim() !== "")
			.map((pair): [string, string] => {
				const [key = "", ...rest] = pair.split(":");
				return [
					key.trim(),
					rest
						.join(":")
						.trim()
						.replace(/^'+|'+$/g, ""),
				];
			}),
	);
}

type Converter = (options: Options, written: string) => string;

const converters: Readonly<Record<string, Converter>> = {
	number: (options, written) => call("number", options, written),
	currency: (options, written) => currencyCall(options, written),
	datetime: (options, written) => dateCall(options, written),
	relativetime: (options, written) => {
		const unit = options.get("range") ?? "day";
		const rest = [...options].filter(([key]) => key !== "range");
		return call("relativetime", new Map([["unit", unit], ...rest]), written);
	},
	list: (options, written) => call("list", options, written),
};

/** A call of a function with options, checked as the compiler reads it. */
function call(fn: string, options: Options, written: string): string {
	const text = [...options].map(([key, value]) => ` ${key}=${value}`).join("");
	parseCall(fn, text, written);
	return `:${fn}${text}`;
}

/**
 * A currency as `:currency`, its fraction digits as one fractionDigits when i18next gives both
 * alike; or, when it passes an option `:currency` does not take, as `:number style=currency`.
 */
function currencyCall(options: Options, written: string): string {
	const minimum = options.get("minimumFractionDigits");
	const currency = new Map(options);
	if (
		minimum !== undefined &&
		minimum === options.get("maximumFractionDigits")
	) {
		currency.delete("minimumFractionDigits");
		currency.delete("maximumFractionDigits");
		currency.set("fractionDigits", minimum);
	}
	const taken = [...currency.keys()].every((key) =>
		Object.hasOwn(functions.currency?.options ?? {}, key),
	);
	return taken
		? call("currency", currency, written)
		: call("number", new Map([["style", "currency"], ...options]), written);
}

/**
 * A date as `:datetime` with i18next's options; given none that chooses the fields, as Intl's
 * default, a numeric date.
 */
function dateCall(options: Options, written: string): string {
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
