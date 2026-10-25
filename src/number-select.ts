/**
 * Selecting on a `:number`, `:integer` or `:percent` local, as MessageFormat 2 selects on it: a
 * key that is a number matches the value exactly, a key that is a category matches the value's
 * CLDR category of the rules `select` names, and an exact match comes before a category.
 */

import type { IntlOptions, SelectedNumber } from "./format-functions.ts";
import type { SelectMode } from "./format-options.ts";
import { shownDigits } from "./intl-formatters.ts";
import type { FormattedLocal } from "./message-declarations.ts";
import { isNumberLiteral } from "./pattern.ts";
import { categoriesOf, type PluralType } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A selector on a number local: the input it reads, the number it compares, and the rules its
 * categories come from, none for `select=exact`. A local whose options round it is read as the
 * digits those options show (`digits`, the options Intl shows them with), as its exact keys and
 * its plural category are of what a reader sees.
 */
export type NumberSelector = {
	kind: "number";
	name: string;
	input: string;
	number: SelectedNumber;
	/** What `:offset` adds to the number before it is compared; 0 for the other functions. */
	shift: number;
	rules: PluralType | undefined;
	digits: IntlOptions | undefined;
};

/** The rules each `select` mode chooses a category by. */
const rulesByMode: Readonly<Record<SelectMode, PluralType | undefined>> = {
	plural: "cardinal",
	ordinal: "ordinal",
	exact: undefined,
};

/** Options that change how a number is written, but not which number it is. */
const writingOptions: ReadonlySet<string> = new Set([
	"signDisplay",
	"useGrouping",
	"numberingSystem",
	"minimumIntegerDigits",
]);

/** Options that round a number, which Intl.PluralRules takes too: they choose the digits shown. */
const roundingOptions: ReadonlySet<string> = new Set([
	"minimumFractionDigits",
	"maximumFractionDigits",
	"minimumSignificantDigits",
	"maximumSignificantDigits",
	"roundingPriority",
	"roundingIncrement",
	"roundingMode",
	"trailingZeroDisplay",
]);

/** The rules a number local's categories come from, none for select=exact or a date. */
export function selectRules(local: FormattedLocal): PluralType | undefined {
	return local.selection === undefined
		? undefined
		: rulesByMode[local.selection.mode];
}

/** A selector on a formatted local; throws a MessageProblem for one grai cannot select on. */
export function numberSelector(
	name: string,
	local: FormattedLocal,
): NumberSelector {
	if (local.selection === undefined) {
		throw new MessageProblem(
			"unsupported",
			`it selects on ${name}, a :${local.fn} value, which MessageFormat 2 does not select on. Select on the input, or on a :number local of it.`,
		);
	}
	const shaping = local.given.filter(
		(option) => !writingOptions.has(option) && !roundingOptions.has(option),
	);
	if (shaping.length > 0) {
		const them = shaping.length === 1 ? "it" : "them";
		throw new MessageProblem(
			"unsupported",
			`it selects on ${name}, a :${local.fn} with ${shaping.join(", ")}, which shows more than digits, and Intl.PluralRules has no category for that. Select on a local without ${them}, and format with ${them} in the pattern.`,
		);
	}
	const rounds = local.given.some((option) => roundingOptions.has(option));
	return {
		kind: "number",
		name,
		input: local.input,
		number: local.selection.number,
		shift: local.format.shift,
		rules: selectRules(local),
		digits: rounds ? digitOptions(local.format.options) : undefined,
	};
}

/**
 * The options a rounding local's digits are shown with: its own, but those that only change how
 * they are written, and without grouping, so that plural rules read them and keys match them.
 */
function digitOptions(options: IntlOptions): IntlOptions {
	const kept = Object.entries(options).filter(
		([option]) => !writingOptions.has(option),
	);
	return { ...Object.fromEntries(kept), useGrouping: false };
}

/**
 * Whether a key is a number, which matches a value equal to it. MessageFormat 2 compares the key
 * with the value written as a number literal, and JavaScript writes a number one way, so `1.0`
 * or `01` can never match.
 */
export function isExactKey(key: string): boolean {
	return isNumberLiteral(key);
}

/** The value an exact key stands for: its number, or for `:percent` the hundredth it shows. */
function keyValue(selector: NumberSelector, key: string): number {
	if (selector.number !== "percent") return Number(key);
	const [digits, exponent = "0"] = key.toLowerCase().split("e");
	return Number(`${digits}e${Number(exponent) - 2}`);
}

/** Checks that a variant's key can be chosen for some value of the selector in the locale. */
export function checkNumberKey(
	selector: NumberSelector,
	key: string,
	locale: string,
): void {
	if (isExactKey(key) && selector.digits !== undefined) {
		// Rounding a number its options already show leaves it as it is, so a key no value shows is
		// one its own number is not shown as: for a percent, the hundredth it is the percent of.
		const shown = shownDigits(selector.digits, keyValue(selector, key));
		if (shown !== key) {
			throw new MessageProblem(
				"message-invalid",
				`the variant ${selector.name}=${key} can never be chosen: ${selector.name} shows ${key} as ${shown}, and no value as ${key}. Write the key as ${selector.name} shows it.`,
			);
		}
		return;
	}
	if (isExactKey(key)) {
		const shortest = String(Number(key));
		if (shortest !== key) {
			throw new MessageProblem(
				"message-invalid",
				`the variant ${selector.name}=${key} can never be chosen: a number matches the key it is written as, ${shortest}. Write that instead.`,
			);
		}
		if (selector.number !== "number" && !Number.isInteger(Number(key))) {
			throw new MessageProblem(
				"message-invalid",
				`the variant ${selector.name}=${key} can never be chosen: ${selector.name} is a whole number. Remove it.`,
			);
		}
		return;
	}
	if (selector.rules === undefined) {
		throw new MessageProblem(
			"message-invalid",
			`the variant ${selector.name}=${key} can never be chosen: ${selector.name} selects by its exact value (select=exact), so a key is a number or *.`,
		);
	}
	const categories = categoriesOf(locale, selector.rules);
	if (!categories.includes(key)) {
		throw new MessageProblem(
			"plural-category-unknown",
			`"${key}" is not a number or ${selector.rules === "ordinal" ? "an ordinal" : "a plural"} category of ${locale}, so the variant ${selector.name}=${key} can never be chosen. Its categories are ${categories.join(", ")}.`,
		);
	}
}
