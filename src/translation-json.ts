/**
 * Translation units as JSON, for a script such as a machine translation step. A unit's source and
 * target are patterns as the catalogs write them, so a placeholder reads `{count}`; a target must
 * keep each one as its source writes it.
 */

import { isRecord } from "./config.ts";
import { type Piece, patternPieces, piecesPattern } from "./pattern-pieces.ts";
import { MessageProblem } from "./problem.ts";
import type { ReturnedPiece, ReturnedUnit } from "./returned-units.ts";
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

/** Reads a JSON document of units. Throws an Error naming what is not as `grai export --json` writes it. */
export function readUnitsJson(text: string): {
	srcLang: string;
	trgLang: string;
	units: ReturnedUnit[];
} {
	const document: unknown = JSON.parse(text);
	if (
		!isRecord(document) ||
		typeof document.srcLang !== "string" ||
		typeof document.trgLang !== "string" ||
		!Array.isArray(document.units)
	) {
		throw new Error(
			"it is not a document of units: it needs srcLang, trgLang and units.",
		);
	}
	return {
		srcLang: document.srcLang,
		trgLang: document.trgLang,
		units: document.units.map(returnedUnit),
	};
}

function returnedUnit(unit: unknown): ReturnedUnit {
	if (
		!isRecord(unit) ||
		typeof unit.id !== "string" ||
		typeof unit.source !== "string"
	) {
		return {
			id: isRecord(unit) && typeof unit.id === "string" ? unit.id : "",
			source: [],
			target: undefined,
			problem: "a unit needs an id and a source, both strings.",
		};
	}
	const { id, source, target } = unit;
	try {
		return {
			id,
			source: returned(patternPieces(source)),
			target:
				typeof target === "string"
					? returned(patternPieces(target))
					: undefined,
			problem:
				target === undefined || typeof target === "string"
					? undefined
					: "its target must be a string.",
		};
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { id, source: [], target: undefined, problem: error.message };
	}
}

/** Pieces as a returned unit's, each code by the text it is written as. */
function returned(pieces: readonly Piece[]): ReturnedPiece[] {
	return pieces.map((piece) =>
		"text" in piece ? piece : { code: { source: piece.source } },
	);
}
