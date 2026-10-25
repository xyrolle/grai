/**
 * i18next's built-in formats as the MessageFormat 2 calls that format alike: `number`, `currency`,
 * `datetime`, `relativetime` and `list`, with the Intl options i18next passes them.
 */

import { ownEntry } from "../own-entry.ts";
import { MessageProblem } from "../problem.ts";
import { call, dateCall, type IntlOptions, numberCall } from "./intl-calls.ts";

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

type Options = IntlOptions;

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
	currency: (options, written) =>
		numberCall(new Map([["style", "currency"], ...options]), written),
	datetime: (options, written) => dateCall(options, written),
	relativetime: (options, written) => {
		const unit = options.get("range") ?? "day";
		const rest = [...options].filter(([key]) => key !== "range");
		return call("relativetime", new Map([["unit", unit], ...rest]), written);
	},
	list: (options, written) => call("list", options, written),
};
