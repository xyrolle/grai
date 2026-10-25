/** A base message as a locale's seed: its text, with the plural variants the locale chooses among. */

import { isRecord } from "./config.ts";
import { sameJson } from "./edit.ts";
import { parseDeclarations } from "./message-declarations.ts";
import { selectRules } from "./number-select.ts";
import { categoriesOf } from "./plurals.ts";
import { catchAll } from "./selection.ts";

/**
 * A base message as it is seeded into a locale: the same text. A plural, or a number selector's
 * categories, keeps the variants the locale can choose, and its `other` becomes `*` where there
 * is no `*`, so it covers the locale's categories the base locale lacks, such as `few`. Throws a
 * MessageProblem for an invalid declaration; the rest of the message is taken as it is.
 */
export function seedValue(value: unknown, locale: string): unknown {
	const fields = Array.isArray(value) ? value[0] : undefined;
	if (!isRecord(fields) || !isRecord(fields.match)) return value;
	const declarations = Array.isArray(fields.declarations)
		? fields.declarations.filter((item) => typeof item === "string")
		: [];
	const locals = parseDeclarations(declarations);
	const rulesOf = (name: string) => {
		const number = locals.formatted.get(name);
		return number === undefined
			? locals.plurals.get(name)?.type
			: selectRules(number);
	};
	/** Each selector that counts, with the categories of its rules the locale has. */
	const plurals = (
		Array.isArray(fields.selectors) ? fields.selectors : []
	).flatMap((name): [string, ReadonlySet<string>][] => {
		const rules = typeof name === "string" ? rulesOf(name) : undefined;
		return rules === undefined
			? []
			: [[name, new Set(categoriesOf(locale, rules))]];
	});
	if (plurals.length === 0) return value;
	const variants = Object.entries(fields.match).map(
		([key, pattern]): [Map<string, string>, string, unknown] => [
			variantKeys(key),
			key,
			pattern,
		],
	);
	const open = new Set(
		plurals.flatMap(([name]) =>
			variants.some(([keys]) => keys.get(name) === catchAll) ? [name] : [],
		),
	);
	const match: Record<string, unknown> = {};
	for (const [keys, written, pattern] of variants) {
		const seeded = new Map(keys);
		let chosen = true;
		for (const [name, categories] of plurals) {
			const key = keys.get(name) ?? catchAll;
			if (key === "other" && !open.has(name)) seeded.set(name, catchAll);
			else if (!isPluralKey(key, categories)) chosen = false;
		}
		if (!chosen) continue;
		const same = [...keys].every(([name, key]) => seeded.get(name) === key);
		match[same ? written : variantKey(seeded)] = pattern;
	}
	return sameJson(match, fields.match) ? value : [{ ...fields, match }];
}

/** Whether a variant key can be chosen for a count in a locale: a category it has, a number or `*`. */
function isPluralKey(key: string, categories: ReadonlySet<string>): boolean {
	return (
		key === catchAll ||
		categories.has(key) ||
		(key.trim() !== "" && Number.isFinite(Number(key)))
	);
}

/** A variant key such as `countPlural=one,gender=*`, by selector. */
function variantKeys(key: string): Map<string, string> {
	return new Map(
		(key === "" ? [] : key.split(",")).map((part): [string, string] => {
			const [name = "", value = ""] = part
				.split("=")
				.map((side) => side.trim());
			return [name, value];
		}),
	);
}

function variantKey(keys: ReadonlyMap<string, string>): string {
	return [...keys].map(([name, key]) => `${name}=${key}`).join(",");
}
