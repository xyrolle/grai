/**
 * The message a merge writes for a key: the units' texts in the base message's shape, a pattern or
 * declarations, selectors and a variant per unit.
 */

import type { Catalog } from "./catalog.ts";
import { isRecord } from "./config.ts";
import { parseMessage } from "./message.ts";
import { declaredName } from "./message-declarations.ts";
import { type Piece, piecesPattern } from "./pattern-pieces.ts";
import type { Unit } from "./translation-units.ts";
import { translatedVariants } from "./unit-variants.ts";

/** A locale's current message for a key, if it has one. */
export type Translation = { locale: string; value: unknown };

/** A key's merged message, or undefined when a unit has no text, from the file or translated already. */
export function mergedMessage(
	base: Catalog,
	key: string,
	translation: Translation,
	units: readonly Unit[],
	accepted: ReadonlyMap<string, Piece[]>,
): unknown {
	const texts = unitTexts(units, accepted);
	if (texts === undefined) return undefined;
	const source = base.messages.get(key);
	if (typeof source === "string") return texts.get("");
	const fields = fieldsOf(source);
	if (fields === undefined) return undefined;
	return [
		{
			declarations: keptDeclarations(base.locale, source, translation),
			selectors: fields.selectors,
			match: Object.fromEntries(texts),
		},
	];
}

/** Each unit's text by its variant's key, such as `countPlural=one`, or "" for no selector. */
function unitTexts(
	units: readonly Unit[],
	accepted: ReadonlyMap<string, Piece[]>,
): Map<string, string> | undefined {
	const texts = new Map<string, string>();
	for (const unit of units) {
		const pieces = accepted.get(unit.id) ?? unit.target;
		if (pieces === undefined) return undefined;
		const key = unit.variant
			.map(([selector, value]) => `${selector}=${value}`)
			.join(",");
		texts.set(key, piecesPattern(pieces));
	}
	return texts;
}

/**
 * The declarations of a merged message: the translation's, when its variants are the ones the
 * units leave alone, as it has the base's selectors, then each of the base's it lacks, which a code
 * a unit takes from the base may read. Without such a translation, the base's as written.
 */
function keptDeclarations(
	baseLocale: string,
	source: unknown,
	translation: Translation,
): unknown {
	const { selectors } = parseMessage(baseLocale, source);
	const kept = translatedVariants(
		translation.value,
		translation.locale,
		selectors,
	);
	const own = kept === undefined ? [] : declarationsOf(translation.value);
	if (own.length === 0) return fieldsOf(source)?.declarations;
	const names = new Set(own.map(declaredName));
	const lacking = declarationsOf(source).filter(
		(text) => !names.has(declaredName(text)),
	);
	return [...own, ...lacking];
}

function fieldsOf(value: unknown): Record<string, unknown> | undefined {
	const fields = Array.isArray(value) ? value[0] : undefined;
	return isRecord(fields) ? fields : undefined;
}

function declarationsOf(value: unknown): string[] {
	const declarations = fieldsOf(value)?.declarations;
	return Array.isArray(declarations)
		? declarations.filter((text) => typeof text === "string")
		: [];
}
