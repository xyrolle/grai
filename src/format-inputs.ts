/**
 * An option a formatting function takes from an input, as MessageFormat 2 writes it:
 * `{amount :currency currency=$code}`. Only the options an app's data decides can come from an
 * input: which currency an amount is in, which unit a quantity is in, which time zone a reader is
 * in. How the value looks, its style and its fields, is the message's to write, so those stay
 * literal and are checked when compiling. A call takes one such option at most: a currency and a
 * unit go with different styles, and a time zone with a date.
 */

import type { IntlFormatter, IntlOptions } from "./format-functions.ts";
import { MessageProblem } from "./problem.ts";

/**
 * An option an input can give: a value it takes, which the compile checks a call with, and the
 * style it is formatted with, which the call must have, or Intl would leave it out.
 */
type InputOptionSpec = { sample: string; style?: string };

/** The options an input can give, by the formatter that takes them. */
const fromInputs: Readonly<
	Partial<Record<IntlFormatter, Readonly<Record<string, InputOptionSpec>>>>
> = {
	number: {
		currency: { sample: "EUR", style: "currency" },
		unit: { sample: "meter", style: "unit" },
	},
	datetime: { timeZone: { sample: "UTC" } },
};

/**
 * An option a call takes from an input: `currency=$code` is the option currency and the input
 * named code, with what the compile checks the call with.
 */
export type OptionInput = InputOptionSpec & { option: string; name: string };

const reference = /^\$([A-Za-z_$][\w$]*)$/;

/**
 * The input an option's value names, as `currency=$code` names `code`, or undefined for a literal
 * value. `given` is the option an input already gives the call, if one. `source` is the call as
 * written and `token` the option, for the errors.
 */
export function optionInput(
	formatter: IntlFormatter,
	option: string,
	text: string,
	given: OptionInput | undefined,
	where: { source: string; token: string },
): OptionInput | undefined {
	if (!text.startsWith("$")) return undefined;
	const { source, token } = where;
	const spec = fromInputs[formatter]?.[option];
	if (spec === undefined) {
		throw new MessageProblem(
			"unsupported",
			`${source}: "${token}" takes its value from an input, which only a currency, a number's unit and a date's time zone can: how a value looks is the message's to write. Write the value itself.`,
		);
	}
	const name = reference.exec(text)?.[1];
	if (name === undefined) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: "${token}" names no input. Write it as ${option}=$name.`,
		);
	}
	if (given !== undefined) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: "${token}" takes a second option from an input, after ${given.option}. A call takes one: a currency and a unit go with different styles.`,
		);
	}
	return { ...spec, option, name };
}

/**
 * The options to check a call with when compiling: the call's own, and a value the input's option
 * takes. An option formatted with a style needs that style in the call.
 */
export function checkedOptions(
	options: IntlOptions,
	given: OptionInput | undefined,
	source: string,
): IntlOptions {
	if (given === undefined) return options;
	const { option, name, sample, style } = given;
	if (style !== undefined && options.style !== style) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: ${option}=$${name} gives a ${option}, which only style=${style} formats with. Write style=${style} in the call.`,
		);
	}
	return { ...options, [option]: sample };
}
