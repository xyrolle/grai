/** A formatting function's call, as a message writes it: its options checked and made Intl's when compiling. */

import {
	functions,
	type IntlFormatter,
	type IntlOptions,
	type OptionKind,
	type OptionValue,
	shapesText,
} from "./format-functions.ts";
import { MessageProblem } from "./problem.ts";

/** How a value is shown: through an Intl formatter, with the options Intl takes. */
export type Format = { formatter: IntlFormatter; options: IntlOptions };

const option = /^([A-Za-z]\w*)=(\S+)$/;

/**
 * The format a function call asks for, such as `:number` with `minimumFractionDigits=2`, checked
 * by making its formatter once: whether Intl takes the options does not depend on the locale.
 * `source` is the call as written, for the errors.
 */
export function parseFormat(
	name: string,
	optionsText: string,
	source: string,
): Format {
	const spec = functions[name];
	if (spec === undefined) {
		throw new MessageProblem(
			"unsupported",
			`${source} calls :${name}, which grai does not support; the formatting functions are ${Object.keys(
				functions,
			)
				.map((known) => `:${known}`)
				.join(", ")}.`,
		);
	}
	const given: Record<string, OptionValue> = {};
	for (const token of optionsText.trim().split(/\s+/).filter(Boolean)) {
		const [, key = "", text = ""] = option.exec(token) ?? [];
		const kind = spec.options[key];
		if (kind === undefined || Object.hasOwn(given, key)) {
			throw new MessageProblem(
				"message-invalid",
				`${source}: "${token}" is not an option of :${name}, or is given twice. Its options are ${Object.keys(spec.options).join(", ")}.`,
			);
		}
		given[key] = optionValue(kind, text, source, token);
	}
	const shaped = Object.keys(given).some(shapesText);
	const options = {
		...(shaped ? {} : spec.defaults),
		...given,
		...spec.fixed,
	};
	const format: Format = { formatter: spec.formatter, options };
	try {
		if (format.formatter === "number") {
			new Intl.NumberFormat(undefined, options);
		} else {
			new Intl.DateTimeFormat(undefined, options);
		}
	} catch (error) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: Intl cannot format with these options: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return format;
}

function optionValue(
	kind: OptionKind,
	text: string,
	source: string,
	token: string,
): OptionValue {
	if (kind === "text") return text;
	if (kind === "digits" && /^\d+$/.test(text)) return Number(text);
	if (kind === "boolean" && (text === "true" || text === "false")) {
		return text === "true";
	}
	if (kind === "grouping")
		return text === "never" || text === "false" ? false : text;
	throw new MessageProblem(
		"message-invalid",
		`${source}: "${token}" needs ${kind === "digits" ? "a whole number" : "true or false"}.`,
	);
}
