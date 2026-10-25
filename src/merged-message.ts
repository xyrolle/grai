/**
 * The message a merge writes for a key: the units' texts in the shape of the locale's own message,
 * or of the base's when it has none, a pattern or declarations, selectors and a variant per unit.
 */

import type { Catalog } from "./catalog.ts";
import { isRecord } from "./config.ts";
import { declaredName } from "./message-declarations.ts";
import { type Piece, piecesPattern } from "./pattern-pieces.ts";
import type { Unit } from "./translation-units.ts";
import { ownMessage } from "./unit-variants.ts";

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
	const hasOwn =
		ownMessage(translation.value, translation.locale) !== undefined;
	const shape = hasOwn ? translation.value : source;
	if (typeof shape === "string") return texts.get("");
	const fields = fieldsOf(shape);
	if (fields === undefined) return undefined;
	return [
		{
			declarations: hasOwn
				? keptDeclarations(shape, source)
				: fields.declarations,
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
 * The declarations of a merge into the locale's own message: its own, which the variants the units
 * leave alone read, then each of the base's it lacks, which a code a unit takes from the base may
 * read.
 */
function keptDeclarations(own: unknown, source: unknown): string[] {
	const declarations = declarationsOf(own);
	const names = new Set(declarations.map(declaredName));
	const lacking = declarationsOf(source).filter(
		(text) => !names.has(declaredName(text)),
	);
	return [...declarations, ...lacking];
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
