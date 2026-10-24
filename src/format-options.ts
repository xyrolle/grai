/**
 * A formatting function's call, as a message writes it: its options checked and made Intl's when
 * compiling, and its `select` mode.
 */

import {
	functions,
	type IntlFormatter,
	type IntlOptions,
	type OptionKind,
	type OptionValue,
	type SelectedNumber,
	shapesText,
} from "./format-functions.ts";
import { MessageProblem } from "./problem.ts";

/** How a value is shown: through an Intl formatter, with the options Intl takes. */
export type Format = { formatter: IntlFormatter; options: IntlOptions };

/**
 * MessageFormat 2's `select` option of `:number` and `:integer`: how a selector on the call
 * matches, by the exact value and then by its plural or ordinal category, or by the exact value
 * alone. It does not change how the value is formatted.
 */
export type SelectMode = "plural" | "ordinal" | "exact";

/** A call as a local declares it: its function, the options given, its format, and its selection. */
export type Call = {
	fn: string;
	given: readonly string[];
	format: Format;
	/** For a function that selects: the number it compares, and its mode, plural by default. */
	selection: { number: SelectedNumber; mode: SelectMode } | undefined;
};

const option = /^([A-Za-z]\w*)=(\S+)$/;

const selectModes: readonly SelectMode[] = ["plural", "ordinal", "exact"];

/** The format a placeholder's call asks for, such as `{n :number minimumFractionDigits=2}`. */
export function parseFormat(
	name: string,
	optionsText: string,
	source: string,
): Format {
	return parseCall(name, optionsText, source).format;
}

/**
 * A function call, such as `:number` with `minimumFractionDigits=2`: its format, checked by making
 * its formatter once, as whether Intl takes the options does not depend on the locale, and its
 * `select` mode. `source` is the call as written, for the errors.
 */
export function parseCall(
	name: string,
	optionsText: string,
	source: string,
): Call {
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
	const takesSelect = spec.selects?.takesSelect === true;
	let mode: SelectMode | undefined;
	for (const token of optionsText.trim().split(/\s+/).filter(Boolean)) {
		const [, key = "", text = ""] = option.exec(token) ?? [];
		if (key === "select" && takesSelect && mode === undefined) {
			mode = selectModeOf(text, source, token);
			continue;
		}
		const refused = spec.refused?.[key];
		if (refused !== undefined) {
			throw new MessageProblem("unsupported", `${source}: ${refused}`);
		}
		const kind = spec.options[key];
		if (kind === undefined || Object.hasOwn(given, key)) {
			const known = Object.keys(spec.options);
			throw new MessageProblem(
				"message-invalid",
				`${source}: "${token}" is not an option of :${name}, or is given twice. Its options are ${(takesSelect ? ["select", ...known] : known).join(", ")}.`,
			);
		}
		given[key] = optionValue(kind, text, source, token);
	}
	const { required } = spec;
	if (required !== undefined && !Object.hasOwn(given, required.option)) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: :${name} needs the option ${required.option}, such as ${required.example}.`,
		);
	}
	const shaped = Object.keys(given).some(shapesText);
	const options = {
		...(shaped ? {} : spec.defaults),
		...intlOptions(given),
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
	const selection =
		spec.selects === undefined
			? undefined
			: { number: spec.selects.number, mode: mode ?? "plural" };
	return { fn: name, given: Object.keys(given), format, selection };
}

/**
 * The options given, as Intl takes them: `:currency`'s fractionDigits is both Intl's minimum and
 * maximum fraction digits, and `auto` the currency's own.
 */
function intlOptions(given: IntlOptions): IntlOptions {
	const { fractionDigits, ...options } = given;
	return typeof fractionDigits === "number"
		? {
				...options,
				minimumFractionDigits: fractionDigits,
				maximumFractionDigits: fractionDigits,
			}
		: options;
}

function selectModeOf(text: string, source: string, token: string): SelectMode {
	const mode = selectModes.find((known) => known === text);
	if (mode === undefined) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: "${token}" needs plural, ordinal or exact.`,
		);
	}
	return mode;
}

const digits = /^\d+$/;

/** An option's value, read from its text by how the option is read. */
function optionValue(
	kind: OptionKind,
	text: string,
	source: string,
	token: string,
): OptionValue {
	const invalid = (needs: string): never => {
		throw new MessageProblem(
			"message-invalid",
			`${source}: "${token}" needs ${needs}.`,
		);
	};
	switch (kind) {
		case "text":
			return text;
		case "grouping":
			return text === "never" || text === "false" ? false : text;
		case "boolean":
			return text === "true" || text === "false"
				? text === "true"
				: invalid("true or false");
		case "digits":
			return digits.test(text) ? Number(text) : invalid("a whole number");
		case "digitsOrAuto":
			if (text === "auto") return text;
			return digits.test(text)
				? Number(text)
				: invalid("a whole number or auto");
	}
}
