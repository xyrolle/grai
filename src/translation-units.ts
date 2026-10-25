/**
 * Translation units: a locale's messages as a translator works on them, in any file format. A
 * message without selectors is one unit. A message with selectors is one unit per combination of
 * keys the locale needs, each starting from the base text MessageFormat 2 would show for it.
 */

import type { Catalog } from "./catalog.ts";
import { parseMessage } from "./message.ts";
import { type Piece, patternPieces } from "./pattern-pieces.ts";
import { baseCategoryOf, digitsOf, noteOf } from "./plural-forms.ts";
import { isSeed } from "./seed.ts";
import { catchAll, countingRules } from "./selection.ts";
import {
	alignedVariants,
	chosen,
	combinations,
	onto,
	ownMessage,
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
 * The units of a locale, in the base catalog's order: every key, or only the untranslated ones. A
 * key in `identical`, whose message is the base text on purpose, is translated. Throws a
 * MessageProblem for an invalid base message.
 */
export function exportUnits(
	base: Catalog,
	target: Catalog | undefined,
	locale: string,
	identical: ReadonlySet<string>,
	untranslatedOnly = false,
): Unit[] {
	const units: Unit[] = [];
	for (const [key, value] of base.messages) {
		const translation = target?.messages.get(key);
		const translated =
			translation !== undefined &&
			(identical.has(key) || !isSeed(translation, value, locale));
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

/**
 * A message's units. Once the locale has a message of its own, they follow its selection, which may
 * tell apart what the base's does not, such as a gender French agrees a word with, or nothing the
 * base's does; each starts from the base text for the same keys.
 */
function messageUnits(
	key: string,
	value: unknown,
	translation: unknown,
	baseLocale: string,
	locale: string,
): Unit[] {
	const base = parseMessage(baseLocale, value);
	const own = ownMessage(translation, locale);
	const selectors = own?.selectors ?? base.selectors;
	const sources = alignedVariants(value, base.selectors);
	const targets =
		own === undefined ? undefined : alignedVariants(translation, own.selectors);
	// The locale's own variants first, in its order, then the rows of the base's it lacks.
	const rows = [
		...(targets ?? []),
		...onto(sources, base.selectors, selectors),
	];
	return combinations(selectors, rows, locale).map((combination) => {
		const variant = selectors.map((selector, index): [string, string] => [
			selector.name,
			combination[index] ?? catchAll,
		]);
		const inBase = base.selectors.map((selector) => {
			const at = selectors.findIndex(({ name }) => name === selector.name);
			const key = at === -1 ? catchAll : (combination[at] ?? catchAll);
			const rules = countingRules(selector, key);
			return rules === undefined || key === catchAll
				? key
				: baseCategoryOf(key, baseLocale, locale, rules, digitsOf(selector));
		});
		const source = chosen(sources, inBase) ?? "";
		const target =
			targets === undefined ? undefined : chosen(targets, combination);
		return unit(
			key,
			variant,
			source,
			target,
			noteOf(variant, selectors, locale),
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
