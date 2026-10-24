/**
 * Selecting on a `:number` or `:integer` local, as MessageFormat 2 selects on it: a key that is a
 * number matches the value exactly, a key that is a category matches the value's CLDR category of
 * the rules `select` names, and an exact match comes before a category.
 */

import type { SelectMode } from "./format-options.ts";
import type { FormattedLocal } from "./message-declarations.ts";
import { categoriesOf, type PluralType } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A selector on a number local: the input it reads, whether it rounds it to a whole number first,
 * as `:integer` does, and the rules its categories come from, none for `select=exact`.
 */
export type NumberSelector = {
	kind: "number";
	name: string;
	input: string;
	integer: boolean;
	rules: PluralType | undefined;
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
]);

/** The rules a number local's categories come from, none for select=exact or a date. */
export function selectRules(local: FormattedLocal): PluralType | undefined {
	return local.select === undefined ? undefined : rulesByMode[local.select];
}

/** A selector on a formatted local; throws a MessageProblem for one grai cannot select on. */
export function numberSelector(
	name: string,
	local: FormattedLocal,
): NumberSelector {
	if (local.select === undefined) {
		throw new MessageProblem(
			"unsupported",
			`it selects on ${name}, a :${local.fn} value, which MessageFormat 2 does not select on. Select on the input, or on a :number local of it.`,
		);
	}
	const digits = local.given.filter((option) => !writingOptions.has(option));
	if (digits.length > 0) {
		throw new MessageProblem(
			"unsupported",
			`it selects on ${name}, a :${local.fn} with ${digits.join(", ")}, whose category would depend on the digits shown, which grai does not support yet. Select on a local without ${digits.length === 1 ? "it" : "them"}, and format with ${digits.length === 1 ? "it" : "them"} in the pattern.`,
		);
	}
	return {
		kind: "number",
		name,
		input: local.input,
		integer: local.fn === "integer",
		rules: selectRules(local),
	};
}

/** MessageFormat 2's number-literal, such as `0`, `-2`, `1.5` or `1e+21`. */
const numberLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/**
 * Whether a key is a number, which matches a value equal to it. MessageFormat 2 compares the key
 * with the value written as a number literal, and JavaScript writes a number one way, so `1.0`
 * or `01` can never match.
 */
export function isExactKey(key: string): boolean {
	return numberLiteral.test(key);
}

/** Checks that a variant's key can be chosen for some value of the selector in the locale. */
export function checkNumberKey(
	selector: NumberSelector,
	key: string,
	locale: string,
): void {
	if (isExactKey(key)) {
		const shortest = String(Number(key));
		if (shortest !== key) {
			throw new MessageProblem(
				"message-invalid",
				`the variant ${selector.name}=${key} can never be chosen: a number matches the key it is written as, ${shortest}. Write that instead.`,
			);
		}
		if (selector.integer && !Number.isInteger(Number(key))) {
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
