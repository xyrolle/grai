/** Units as a file gives them back, and their codes resolved to the codes of the units grai exports now. */

import type { Code, Piece } from "./pattern-pieces.ts";
import type { Unit } from "./translation-units.ts";

/** A code in a unit a file gives back: by its id and how it was written there, or as the catalog writes it. */
export type CodeReference =
	| { id: string; written: "ph" | "start" | "end" }
	| { source: string };

export type ReturnedPiece = { text: string } | { code: CodeReference };

/**
 * A unit as a file gives it back: its id, the source it was made from, and the translation, or
 * why the file's unit could not be read.
 */
export type ReturnedUnit = {
	id: string;
	source: readonly ReturnedPiece[];
	target: readonly ReturnedPiece[] | undefined;
	problem: string | undefined;
};

export function codesOf(unit: Unit): Code[] {
	return unit.source.filter((piece): piece is Code => "id" in piece);
}

/** The codes of each message, from all its units, one of each id. */
export function codesByKey(units: readonly Unit[]): Map<string, Code[]> {
	const keys = new Map<string, Map<string, Code>>();
	for (const unit of units) {
		const codes = keys.get(unit.key) ?? new Map<string, Code>();
		for (const code of codesOf(unit)) {
			if (!codes.has(`${code.id} ${code.kind}`))
				codes.set(`${code.id} ${code.kind}`, code);
		}
		keys.set(unit.key, codes);
	}
	return new Map([...keys].map(([key, codes]) => [key, [...codes.values()]]));
}

/** Returned pieces, each code resolved to one of the given codes; undefined if one is not among them. */
export function resolved(
	pieces: readonly ReturnedPiece[],
	codes: readonly Code[],
): Piece[] | undefined {
	const result: Piece[] = [];
	for (const piece of pieces) {
		if ("text" in piece) {
			result.push(piece);
			continue;
		}
		const code = codes.find((candidate) =>
			refersTo(piece.code, candidate, codes),
		);
		if (code === undefined) return undefined;
		result.push(code);
	}
	return result;
}

/** Whether a reference names a code: by its source, or by its id, as a lone code or a tag pair's. */
function refersTo(
	reference: CodeReference,
	code: Code,
	codes: readonly Code[],
): boolean {
	if ("source" in reference) return reference.source === code.source;
	if (reference.id !== code.id) return false;
	const paired = codes.filter((other) => other.id === code.id).length === 2;
	return reference.written === "ph"
		? !paired
		: reference.written === "start"
			? code.kind === "open"
			: code.kind === "close";
}
