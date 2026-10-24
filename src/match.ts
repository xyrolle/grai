/** A message's `match`: its variants, each with its keys split by selector. */

import { isRecord } from "./config.ts";
import { parsePattern } from "./pattern.ts";
import { MessageProblem } from "./problem.ts";
import type { Selector, Variant } from "./selection.ts";

/** The variants of `match`, each key split by selector; two variants with the same keys are an error. */
export function parseMatch(
	match: unknown,
	selectors: readonly Selector[],
): Variant[] {
	if (!isRecord(match) || Object.keys(match).length === 0) {
		throw new MessageProblem(
			"message-invalid",
			'"match" must be an object of patterns by variant key, such as { "countPlural=one": "…" }.',
		);
	}
	const variants: Variant[] = [];
	const written = new Set<string>();
	for (const [key, pattern] of Object.entries(match)) {
		if (typeof pattern !== "string") {
			throw new MessageProblem(
				"message-invalid",
				`the variant "${key}" must be a pattern string.`,
			);
		}
		const keys = parseVariantKey(key, selectors);
		if (written.has(keys.join(","))) {
			throw new MessageProblem(
				"message-invalid",
				`two variants have the keys ${keys.join(",")}, so one of them can never be chosen. Remove one.`,
			);
		}
		written.add(keys.join(","));
		variants.push({ keys, pattern: parsePattern(pattern) });
	}
	return variants;
}

/** Splits a variant key such as `a=one,b=*` into one key per selector, in selector order. */
export function parseVariantKey(
	key: string,
	selectors: readonly Selector[],
): string[] {
	const keys = new Map<string, string>();
	for (const part of key === "" ? [] : key.split(",")) {
		const [name = "", value = "", extra] = part
			.split("=")
			.map((side) => side.trim());
		if (name === "" || value === "" || extra !== undefined) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" must be selector=value pairs joined by commas, such as "countPlural=one".`,
			);
		}
		if (
			!selectors.some((selector) => selector.name === name) ||
			keys.has(name)
		) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" names "${name}", which is not a selector or is named twice; the selectors are ${listOf(selectors)}.`,
			);
		}
		keys.set(name, value);
	}
	return selectors.map((selector) => {
		const value = keys.get(selector.name);
		if (value === undefined) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" has no value for the selector "${selector.name}". Give it one, or * for any.`,
			);
		}
		return value;
	});
}

function listOf(selectors: readonly Selector[]): string {
	return selectors.length === 0
		? "none"
		: selectors.map((selector) => selector.name).join(", ");
}
