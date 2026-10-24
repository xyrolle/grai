/**
 * Translation units as JSON, for a script such as a machine translation step. A unit's source and
 * target are patterns as the catalogs write them, so a placeholder reads `{count}`.
 */

import { piecesPattern } from "./pattern-pieces.ts";
import type { Unit } from "./translation-units.ts";

/** A locale's units as a JSON document. */
export function writeUnitsJson(
	srcLang: string,
	trgLang: string,
	units: readonly Unit[],
): string {
	const written = units.map((unit) => ({
		id: unit.id,
		key: unit.key,
		...(unit.variant.length > 0 && {
			variant: Object.fromEntries(unit.variant),
		}),
		...(unit.note !== undefined && { note: unit.note }),
		source: piecesPattern(unit.source),
		...(unit.target !== undefined && { target: piecesPattern(unit.target) }),
	}));
	return `${JSON.stringify({ srcLang, trgLang, units: written }, null, "\t")}\n`;
}
