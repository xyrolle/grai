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
		const joined = keys.join(",");
		if (written.has(joined)) {
			throw new MessageProblem(
				"message-invalid",
				`two variants have the keys ${joined}, so one of them can never be chosen. Remove one.`,
			);
		}
		written.add(joined);
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
		const equals = part.indexOf("=");
		const name = equals === -1 ? part.trim() : part.slice(0, equals).trim();
		const value = equals === -1 ? "" : part.slice(equals + 1).trim();
		if (name === "" || value === "" || part.includes("=", equals + 1)) {
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
