/**
 * The variants a message's units are for, in a locale: which combinations of keys its translators
 * write, the base text for each, and a note of what each is for.
 */

import { isRecord } from "./config.ts";
import { parseVariantKey } from "./match.ts";
import { parseMessage } from "./message.ts";
import { categoriesOf, type PluralType } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";
import { catchAll, type Selector } from "./selection.ts";

/** A message's variants as written: each one's keys, one per selector, and its pattern. */
export type Variants = readonly (readonly [
	keys: readonly string[],
	pattern: string,
])[];

export function rawVariants(value: unknown): [string, string][] {
	const fields = Array.isArray(value) ? value[0] : undefined;
	if (!isRecord(fields) || !isRecord(fields.match)) return [];
	return Object.entries(fields.match).flatMap(
		([key, pattern]): [string, string][] =>
			typeof pattern === "string" ? [[key, pattern]] : [],
	);
}

export function alignedVariants(
	value: unknown,
	selectors: readonly Selector[],
): Variants {
	return rawVariants(value).map(([key, pattern]) => [
		parseVariantKey(key, selectors),
		pattern,
	]);
}

/** A translation's variants, aligned to the base message's selectors, if it has the same ones. */
export function translatedVariants(
	translation: unknown,
	locale: string,
	selectors: readonly Selector[],
): Variants | undefined {
	if (translation === undefined || typeof translation === "string")
		return undefined;
	try {
		const names = parseMessage(locale, translation).selectors.map(
			(selector) => selector.name,
		);
		if (names.join() !== selectors.map((selector) => selector.name).join())
			return undefined;
		return alignedVariants(translation, selectors);
	} catch (error) {
		// A translation that does not compile is exported as untranslated; the compile names it.
		if (error instanceof MessageProblem) return undefined;
		throw error;
	}
}

/**
 * The combinations of keys a locale needs. The variants are taken in rows, by their keys for the
 * selectors other than plurals. A plural takes each of the locale's categories in a row that tells
 * counts apart, or in the row of anything else; in a row that does not, such as `count=0`, it
 * keeps `*`, one text for any count.
 */
export function combinations(
	selectors: readonly Selector[],
	variants: Variants,
	locale: string,
): string[][] {
	const plural = selectors.map((selector) => selector.kind === "plural");
	const rows = new Map<string, (readonly string[])[]>();
	for (const [keys] of variants) {
		const row = keys.filter((_, index) => !plural[index]).join("\0");
		rows.set(row, [...(rows.get(row) ?? []), keys]);
	}
	const all = new Map<string, string[]>();
	for (const row of rows.values()) {
		const [first = []] = row;
		const anything = first.every(
			(key, index) => plural[index] || key === catchAll,
		);
		const keyLists = selectors.map((selector, index) => {
			if (selector.kind !== "plural") return [first[index] ?? catchAll];
			const counts = anything || row.some((keys) => keys[index] !== catchAll);
			return counts ? [...categoriesOf(locale, selector.type)] : [catchAll];
		});
		for (const combination of product(keyLists)) {
			all.set(combination.join("\0"), combination);
		}
	}
	return [...all.values()];
}

function product(lists: readonly (readonly string[])[]): string[][] {
	return lists.reduce<string[][]>(
		(all, keys) =>
			all.flatMap((combination) => keys.map((key) => [...combination, key])),
		[[]],
	);
}

/**
 * The pattern MessageFormat 2 would choose for a combination of keys: the variants whose keys all
 * match, as written or as `*`, a literal key before `*` selector by selector, then the first
 * written.
 */
export function chosen(
	variants: Variants,
	combination: readonly string[],
): string | undefined {
	const candidates = variants.filter(([keys]) =>
		keys.every(
			(key, index) =>
				key === catchAll || key === (combination[index] ?? catchAll),
		),
	);
	const rank = (keys: readonly string[]) =>
		keys.map((key) => (key === catchAll ? 1 : 0)).join("");
	candidates.sort((a, b) =>
		rank(a[0]) < rank(b[0]) ? -1 : rank(a[0]) > rank(b[0]) ? 1 : 0,
	);
	return candidates[0]?.[1];
}

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

/** For a plural, the counts each form is for in the locale; for a select, the value. */
export function noteOf(
	variant: readonly (readonly [string, string])[],
	selectors: readonly Selector[],
	locale: string,
): string {
	return variant
		.map(([name, key], index) => {
			const selector = selectors[index];
			if (selector?.kind !== "plural") {
				return key === catchAll
					? `${name}: any other value`
					: `${name}: ${key}`;
			}
			return key === catchAll
				? `${name}: any count`
				: `${name}: ${key}, as for ${examplesOf(key, locale, selector.type)}`;
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
