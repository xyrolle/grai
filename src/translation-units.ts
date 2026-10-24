/**
 * Translation units: a locale's messages as a translator works on them, in any file format. A
 * message without selectors is one unit. A message with selectors is one unit per combination of
 * keys the locale needs, each starting from the base text MessageFormat 2 would show for it.
 */

import type { Catalog } from "./catalog.ts";
import { parseMessage } from "./message.ts";
import { type Piece, patternPieces } from "./pattern-pieces.ts";
import { isSeed } from "./seed.ts";
import { catchAll, countingRules } from "./selection.ts";
import {
	alignedVariants,
	baseCategoryOf,
	chosen,
	combinations,
	noteOf,
	rawVariants,
	translatedVariants,
} from "./unit-variants.ts";

export type Unit = {
	id: string;
	key: string;
	/** For a message with selectors, the key of each selector this unit is the text for. */
	variant: readonly (readonly [selector: string, key: string])[];
	source: readonly Piece[];
	/** The locale's text, unless it is untranslated. */
	target: readonly Piece[] | undefined;
	/** What a translator needs to know of the variant, such as the counts a plural form is for. */
	note: string | undefined;
};

/**
 * The units of a locale, in the base catalog's order: every key, or only the untranslated ones.
 * Throws a MessageProblem for an invalid base message.
 */
export function exportUnits(
	base: Catalog,
	target: Catalog | undefined,
	locale: string,
	untranslatedOnly = false,
): Unit[] {
	const units: Unit[] = [];
	for (const [key, value] of base.messages) {
		const translation = target?.messages.get(key);
		const translated =
			translation !== undefined && !isSeed(translation, value, locale);
		if (untranslatedOnly && translated) continue;
		units.push(
			...messageUnits(
				key,
				value,
				translated ? translation : undefined,
				base.locale,
				locale,
			),
		);
	}
	return units;
}

function messageUnits(
	key: string,
	value: unknown,
	translation: unknown,
	baseLocale: string,
	locale: string,
): Unit[] {
	const message = parseMessage(baseLocale, value);
	if (message.selectors.length === 0) {
		const source =
			typeof value === "string" ? value : (rawVariants(value)[0]?.[1] ?? "");
		const target = typeof translation === "string" ? translation : undefined;
		return [unit(key, [], source, target, undefined)];
	}
	const sources = alignedVariants(value, message.selectors);
	const targets = translatedVariants(translation, locale, message.selectors);
	return combinations(message.selectors, sources, locale).map((combination) => {
		const variant = message.selectors.map(
			(selector, index): [string, string] => [
				selector.name,
				combination[index] ?? catchAll,
			],
		);
		const inBase = combination.map((key, index) => {
			const rules = countingRules(message.selectors[index], key);
			return rules === undefined || key === catchAll
				? key
				: baseCategoryOf(key, baseLocale, locale, rules);
		});
		const source = chosen(sources, inBase) ?? "";
		const target =
			targets === undefined ? undefined : chosen(targets, combination);
		return unit(
			key,
			variant,
			source,
			target,
			noteOf(variant, message.selectors, locale),
		);
	});
}

function unit(
	key: string,
	variant: readonly (readonly [string, string])[],
	source: string,
	target: string | undefined,
	note: string | undefined,
): Unit {
	const id = [key, ...variant.flat()].map(idPart).join(".");
	return {
		id,
		key,
		variant,
		source: patternPieces(source),
		target: target === undefined ? undefined : patternPieces(target),
		note,
	};
}

/** Text as a unit id may hold it: letters, digits and _ as they are, any other character as -hex-. */
function idPart(text: string): string {
	return text.replaceAll(
		/[^A-Za-z0-9_]/gu,
		(character) => `-${(character.codePointAt(0) ?? 0).toString(16)}-`,
	);
}
