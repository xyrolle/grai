/**
 * A locale's plural forms as its translators meet them: the base locale's form each starts from,
 * and the counts each is for.
 */

import type { PluralType } from "./plurals.ts";
import { catchAll, countingRules, type Selector } from "./selection.ts";

/**
 * The base locale's category whose text a translator of a locale's category starts from: the one
 * the base locale gives the same counts, or `other` when it gives them several, such as `ru`'s
 * `one`, which is 1 and 21, `one` and `other` in English. A count then shows wherever the locale
 * needs it.
 */
export function baseCategoryOf(
	category: string,
	baseLocale: string,
	locale: string,
	type: PluralType,
): string {
	const memo = `${type} ${baseLocale} ${locale} ${category}`;
	const known = baseCategories.get(memo);
	if (known !== undefined) return known;
	const rules = pluralRulesOf(locale, type);
	const base = pluralRulesOf(baseLocale, type);
	const categories = new Set<string>();
	for (const count of sampleCounts) {
		if (rules.select(count) === category) categories.add(base.select(count));
	}
	const [only] = categories;
	const chosen = categories.size === 1 && only !== undefined ? only : "other";
	baseCategories.set(memo, chosen);
	return chosen;
}

const baseCategories = new Map<string, string>();
const pluralRules = new Map<string, Intl.PluralRules>();

function pluralRulesOf(locale: string, type: PluralType): Intl.PluralRules {
	const memo = `${type} ${locale}`;
	const rules = pluralRules.get(memo) ?? new Intl.PluralRules(locale, { type });
	pluralRules.set(memo, rules);
	return rules;
}

/** Counts that show each category of every locale: the whole numbers to 200, and some fractions. */
const sampleCounts = [
	...Array.from({ length: 201 }, (_, count) => count),
	0.5,
	1.5,
	2.5,
	10.5,
	1000,
	1000000,
];

/** For a plural, the counts each form is for in the locale; for a select, the value; for no selector, nothing. */
export function noteOf(
	variant: readonly (readonly [string, string])[],
	selectors: readonly Selector[],
	locale: string,
): string | undefined {
	if (variant.length === 0) return undefined;
	return variant
		.map(([name, key], index) => {
			const rules = countingRules(selectors[index], key);
			if (rules === undefined) {
				return key === catchAll
					? `${name}: any other value`
					: `${name}: ${key}`;
			}
			return key === catchAll
				? `${name}: any count`
				: `${name}: ${key}, as for ${examplesOf(key, locale, rules)}`;
		})
		.join("; ");
}

function examplesOf(
	category: string,
	locale: string,
	type: PluralType,
): string {
	const memo = `${type} ${locale} ${category}`;
	const known = examples.get(memo);
	if (known !== undefined) return known;
	const rules = pluralRulesOf(locale, type);
	const counts: number[] = [];
	for (let count = 0; count <= 1000 && counts.length < 6; count++) {
		if (rules.select(count) === category) counts.push(count);
	}
	const fractions = [0.5, 1.5, 2.5].filter(
		(count) => rules.select(count) === category,
	);
	const written = [...counts, ...fractions].join(", ").concat(", …");
	examples.set(memo, written);
	return written;
}

const examples = new Map<string, string>();
