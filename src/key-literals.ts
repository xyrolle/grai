/** The literal types a selection's keys give an input, by the kind of value the input takes. */

import { timeUnits } from "./format-functions.ts";
import type { Kind } from "./input-types.ts";

/** A key's literal types: a number key's the number and its text, as `String(value)` matches it. */
const numberOrText = (key: string, numeric: boolean): string[] =>
	numeric ? [key, JSON.stringify(key)] : [JSON.stringify(key)];

/** The literal types of a key a value of a kind can be. */
const keyLiterals: Readonly<
	Record<Kind, (key: string, numeric: boolean) => string[]>
> = {
	any: numberOrText,
	text: numberOrText,
	date: (key, numeric) => (numeric ? [key] : []),
	number: (key, numeric) => (numeric ? [key] : []),
	list: () => [],
	string: (key) => [JSON.stringify(key)],
	timeUnit: (key) => (timeUnits.has(key) ? [JSON.stringify(key)] : []),
};

/** The literal types a value of a kind can match the keys by. */
export function literals(
	kind: Kind | undefined,
	keys: ReadonlySet<string>,
): string[] {
	const literalsOf = keyLiterals[kind ?? "any"];
	return [...keys].sort(byValue).flatMap((key) => {
		const number = Number(key);
		return literalsOf(key, Number.isFinite(number) && String(number) === key);
	});
}

function byValue(a: string, b: string): number {
	const difference = Number(a) - Number(b);
	return Number.isNaN(difference) ? (a < b ? -1 : a > b ? 1 : 0) : difference;
}
