/**
 * The variants a message's units are for, in a locale: which combinations of keys its translators
 * write, the base text for each, and a note of what each is for.
 */

import { isRecord } from "./config.ts";
import { parseVariantKey } from "./match.ts";
import { type LocaleMessage, parseMessage } from "./message.ts";
import { categoriesOf } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";
import { catchAll, countingRules, type Selector } from "./selection.ts";

/** A message's variants as written: each one's keys, one per selector, and its pattern. */
export type Variants = readonly (readonly [
	keys: readonly string[],
	pattern: string,
])[];

/** A message's variants as written, each its key and its pattern; a pattern alone is one with no key. */
function rawVariants(value: unknown): [string, string][] {
	if (typeof value === "string") return [["", value]];
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

/** A locale's message for a key, parsed, if it has one that compiles; the compile names one that does not. */
export function ownMessage(
	translation: unknown,
	locale: string,
): LocaleMessage | undefined {
	if (translation === undefined) return undefined;
	try {
		return parseMessage(locale, translation);
	} catch (error) {
		if (error instanceof MessageProblem) return undefined;
		throw error;
	}
}

/** Variants with their keys moved onto other selectors: each one's key for the selector of its name, else `*`. */
export function onto(
	variants: Variants,
	from: readonly Selector[],
	to: readonly Selector[],
): Variants {
	const at = to.map((selector) =>
		from.findIndex(({ name }) => name === selector.name),
	);
	return variants.map(([keys, pattern]) => [
		at.map((index) => keys[index] ?? catchAll),
		pattern,
	]);
}

/**
 * The combinations of keys a locale needs. The variants are taken in rows, by their keys that do
 * not count: those of a select, and a number's exact ones. A key that counts, a plural's or a
 * number's category or `*`, takes each of the locale's categories in a row that tells counts
 * apart, or in the row of anything else; in a row that does not, such as `count=0`, it keeps `*`,
 * one text for any count.
 */
export function combinations(
	selectors: readonly Selector[],
	variants: Variants,
	locale: string,
): string[][] {
	const counting = (key: string, index: number) =>
		countingRules(selectors[index], key) !== undefined;
	const rows = new Map<string, (readonly string[])[]>();
	for (const [keys] of variants) {
		const row = keys
			.map((key, index) => (counting(key, index) ? "" : key))
			.join("\0");
		rows.set(row, [...(rows.get(row) ?? []), keys]);
	}
	const all = new Map<string, string[]>();
	for (const row of rows.values()) {
		const [first = []] = row;
		const anything = first.every(
			(key, index) => counting(key, index) || key === catchAll,
		);
		const keyLists = selectors.map((selector, index) => {
			const key = first[index] ?? catchAll;
			const rules = countingRules(selector, key);
			if (rules === undefined) return [key];
			const counts = anything || row.some((keys) => keys[index] !== catchAll);
			return counts ? [...categoriesOf(locale, rules)] : [catchAll];
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
