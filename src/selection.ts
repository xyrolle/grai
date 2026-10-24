import type { Part } from "./pattern.ts";
import { categoriesOf } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/** What a variant's key accepts for one selector: a literal value, or anything. */
export const catchAll = "*";

/** A selector: the plural category of an input, or an input's value itself. */
export type Selector =
	| { kind: "plural"; name: string; input: string }
	| { kind: "input"; name: string };

export type Variant = { keys: readonly string[]; pattern: readonly Part[] };

/** A message's variants in the order a call tries them, and whether a value can match none. */
export type Selection = {
	variants: readonly Variant[];
	/** True when an input selector lists its values without `*`, so another value matches nothing. */
	closed: boolean;
};

/** Any value an input selector's keys do not list. */
const otherValue: unique symbol = Symbol("other value");
type Value = string | typeof otherValue;

/**
 * Orders a message's variants by MessageFormat 2's preference (a literal key before `*`, selector
 * by selector, then the order written), after checking that every value has a variant.
 */
export function selectionOf(
	locale: string,
	selectors: readonly Selector[],
	variants: readonly Variant[],
): Selection {
	if (selectors.length === 0) return { variants, closed: false };
	const domains = selectors.map((selector, index): Value[] => {
		const keys = new Set(
			variants.map((variant) => variant.keys[index] ?? catchAll),
		);
		const listsAny = keys.delete(catchAll);
		if (selector.kind === "input") {
			return listsAny ? [...keys, otherValue] : [...keys];
		}
		const categories = categoriesOf(locale, "cardinal");
		for (const key of keys) {
			if (!categories.includes(key)) {
				throw new MessageProblem(
					"plural-category-unknown",
					`"${key}" is not a plural category of ${locale}, so the variant ${selector.name}=${key} can never be chosen. Its categories are ${[...categories].join(", ")}.`,
				);
			}
		}
		return [...categories];
	});
	const missing = uncovered(domains, variants);
	if (missing !== undefined) {
		const key = selectors
			.map((selector, index) => `${selector.name}=${describe(missing[index])}`)
			.join(",");
		throw new MessageProblem(
			"selection-not-exhaustive",
			`no variant matches ${key}. Add one, or a variant with * for the selectors it does not care about.`,
		);
	}
	return {
		variants: variants.toSorted((a, b) => preference(a) - preference(b)),
		closed: domains.some((domain, index) => {
			return selectors[index]?.kind === "input" && !domain.includes(otherValue);
		}),
	};
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
					(key, at) => key === catchAll || key === combination[at],
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

/** Literal keys before `*`, the first selector weighing most: a lower number is tried first. */
function preference(variant: Variant): number {
	return variant.keys.reduce(
		(rank, key) => rank * 2 + (key === catchAll ? 1 : 0),
		0,
	);
}

function describe(value: Value | undefined): string {
	return value === otherValue || value === undefined
		? "(any other value)"
		: value;
}
