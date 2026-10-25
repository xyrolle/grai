import type { Need } from "./icu-readings.ts";

/** What a select's option needs of its input: its key, or for `other` none of the choice's keys. */
export function selectNeeds(
	input: string,
	key: string,
	keys: readonly string[],
): Map<string, Need> {
	return new Map([[input, keyNeed(key, keys.filter(isNamed))]]);
}

/**
 * What a plural's option needs, as ICU tries an `=n` before the categories: an `=n` that value of
 * the input; a category none of the exact values and that category of the plural local; `other`
 * none of the exact values and none of the categories listed.
 */
export function pluralNeeds(
	input: string,
	local: string,
	key: string,
	keys: readonly string[],
): Map<string, Need> {
	const exact = keys.filter(isExact);
	if (isExact(key)) return new Map([[input, keyNeed(key, exact)]]);
	const categories = keys.filter((other) => isNamed(other) && !isExact(other));
	const needs = new Map([[local, keyNeed(key, categories)]]);
	if (exact.length > 0) needs.set(input, keyNeed("other", exact));
	return needs;
}

/** What an option needs of a selector: its key, an `=n` as `n`, or for `other` none of `keys`. */
function keyNeed(key: string, keys: readonly string[]): Need {
	if (isNamed(key)) return { is: keyValue(key) };
	return { not: new Set(keys.map(keyValue)) };
}

function isExact(key: string): boolean {
	return key.startsWith("=");
}

function isNamed(key: string): boolean {
	return key !== "other";
}

function keyValue(key: string): string {
	return isExact(key) ? key.slice(1) : key;
}
