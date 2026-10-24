import {
	checkNumberKey,
	isExactKey,
	type NumberSelector,
} from "./number-select.ts";
import type { Part } from "./pattern.ts";
import { categoriesOf, categoryOf, type PluralType } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/** What a variant's key accepts for one selector: a literal value, or anything. */
export const catchAll = "*";

/**
 * A selector: the plural category of an input, by CLDR's rules of a type; a number local, by its
 * exact value and then its category; or an input's value itself.
 */
export type Selector =
	| { kind: "plural"; name: string; input: string; type: PluralType }
	| NumberSelector
	| { kind: "input"; name: string };

export type Variant = { keys: readonly string[]; pattern: readonly Part[] };

/** A message's variants in the order a call tries them, and whether a value can match none. */
export type Selection = {
	variants: readonly Variant[];
	/** True when an input selector lists its values without `*`, so another value matches nothing. */
	closed: boolean;
};

/**
 * One kind of value a selector can take, for the check that every value has a variant: the keys
 * other than `*` that match it, and how the error writes it.
 */
type Value = { keys: ReadonlySet<string>; written: string };

const anyOther: Value = { keys: new Set(), written: "(any other value)" };

/** The value a key names, which only that key matches. */
const named = (key: string): Value => ({
	keys: new Set([key]),
	written: key,
});

/**
 * Orders a message's variants by MessageFormat 2's preference (a literal key before `*`, and for
 * a number an exact key before a category, selector by selector, then the order written), after
 * checking that every value has a variant.
 */
export function selectionOf(
	locale: string,
	selectors: readonly Selector[],
	variants: readonly Variant[],
): Selection {
	if (selectors.length === 0) return { variants, closed: false };
	const domains = selectors.map((selector, index) => {
		const keys = new Set(
			variants.map((variant) => variant.keys[index] ?? catchAll),
		);
		const listsAny = keys.delete(catchAll);
		return domainOf(selector, [...keys], listsAny, locale);
	});
	const missing = uncovered(domains, variants);
	if (missing !== undefined) {
		const key = selectors
			.map(
				(selector, index) =>
					`${selector.name}=${missing[index]?.written ?? anyOther.written}`,
			)
			.join(",");
		throw new MessageProblem(
			"selection-not-exhaustive",
			`no variant matches ${key}. Add one, or a variant with * for the selectors it does not care about.`,
		);
	}
	const rank = (variant: Variant) => preference(variant, selectors);
	return {
		variants: variants.toSorted((a, b) => rank(a) - rank(b)),
		closed: selectors.some(
			(selector, index) =>
				selector.kind === "input" &&
				variants.every((variant) => variant.keys[index] !== catchAll),
		),
	};
}

/**
 * The kinds of value a selector takes. An input takes each value its keys list, and any other
 * when a variant has `*`. A plural takes each category of its locale. A number takes each number
 * its keys list, which a variant of its category also matches, then a count of each category not
 * listed, or for select=exact any other number. A listed fraction is checked as itself only.
 */
function domainOf(
	selector: Selector,
	keys: readonly string[],
	listsAny: boolean,
	locale: string,
): Value[] {
	switch (selector.kind) {
		case "input":
			return listsAny ? [...keys.map(named), anyOther] : keys.map(named);
		case "plural": {
			const categories = categoriesOf(locale, selector.type);
			for (const key of keys) {
				if (!categories.includes(key)) {
					throw new MessageProblem(
						"plural-category-unknown",
						`"${key}" is not ${selector.type === "ordinal" ? "an ordinal" : "a plural"} category of ${locale}, so the variant ${selector.name}=${key} can never be chosen. Its categories are ${categories.join(", ")}.`,
					);
				}
			}
			return categories.map(named);
		}
		case "number": {
			const { rules } = selector;
			for (const key of keys) checkNumberKey(selector, key, locale);
			const exact = keys.filter(isExactKey).map((key) => {
				const count = Number(key);
				return rules === undefined || !Number.isInteger(count)
					? named(key)
					: {
							keys: new Set([key, categoryOf(locale, rules, count)]),
							written: key,
						};
			});
			return rules === undefined
				? [...exact, anyOther]
				: [...exact, ...categoriesOf(locale, rules).map(named)];
		}
	}
}

/** The first combination of selector values no variant matches, if any. */
function uncovered(
	domains: readonly (readonly Value[])[],
	variants: readonly Variant[],
): Value[] | undefined {
	const combination: Value[] = [];
	const search = (index: number): boolean => {
		if (index === domains.length) {
			return !variants.some((variant) =>
				variant.keys.every(
					(key, at) =>
						key === catchAll || (combination[at]?.keys.has(key) ?? false),
				),
			);
		}
		for (const value of domains[index] ?? []) {
			combination[index] = value;
			if (search(index + 1)) return true;
		}
		return false;
	};
	return search(0) ? combination : undefined;
}

/**
 * The order MessageFormat 2 prefers a variant in, the first selector weighing most: a lower number
 * is tried first. A literal key comes before `*`, and a number's exact key before its category.
 */
function preference(variant: Variant, selectors: readonly Selector[]): number {
	return variant.keys.reduce((rank, key, index) => {
		const selector = selectors[index];
		const weight =
			key === catchAll
				? 2
				: selector?.kind === "number" && !isExactKey(key)
					? 1
					: 0;
		return rank * 3 + weight;
	}, 0);
}
