/**
 * Merging translated units back into a locale's messages. Each unit is checked against the units
 * the catalogs give now: one made from a source that has changed since is stale, one whose target
 * places a code its message does not have is invalid, and both are refused, never the whole file.
 */

import type { Catalog } from "./catalog.ts";
import type { GraiErrorCode } from "./error.ts";
import { mergedMessage } from "./merged-message.ts";
import { parseMessage } from "./message.ts";
import { type Piece, piecesPattern } from "./pattern-pieces.ts";
import { MessageProblem } from "./problem.ts";
import {
	codesByKey,
	codesOf,
	type ReturnedUnit,
	resolved,
} from "./returned-units.ts";
import { shownInputs } from "./shown-inputs.ts";
import { exportUnits, type Unit } from "./translation-units.ts";

/** A unit, or a message, the merge leaves out, and why. */
export type Refusal = {
	key: string;
	unit: string | undefined;
	code: Extract<
		GraiErrorCode,
		"translation-invalid" | "translation-stale" | "translation-incomplete"
	>;
	detail: string;
};

/** The messages a merge changes, by key, how many units changed them, and what it refused. */
export type Merged = {
	messages: [string, unknown][];
	units: number;
	refused: Refusal[];
};

/**
 * Merges the units a file gives back into a locale's messages. A unit without a target is skipped.
 * A message with selectors takes each variant from its unit, else from its current translation;
 * when it has neither, the message is incomplete and left as it is. `identical` is the locale's
 * keys whose message is the base text on purpose, as the export had them.
 */
export function mergeUnits(
	base: Catalog,
	target: Catalog | undefined,
	locale: string,
	identical: ReadonlySet<string>,
	returned: readonly ReturnedUnit[],
): Merged {
	const current = exportUnits(base, target, locale, identical);
	const byId = new Map(current.map((unit) => [unit.id, unit]));
	const keyCodes = codesByKey(current);
	const refused: Refusal[] = [];
	const accepted = new Map<string, Piece[]>();
	const { once, repeated } = givenOnce(returned);
	for (const [id, times] of repeated) {
		refused.push({
			key: byId.get(id)?.key ?? "",
			unit: id,
			code: "translation-invalid",
			detail: `the file gives the unit ${times} times. Keep one.`,
		});
	}
	for (const unit of once) {
		const now = byId.get(unit.id);
		const refuse = (code: Refusal["code"], detail: string) =>
			refused.push({ key: now?.key ?? "", unit: unit.id, code, detail });
		if (unit.problem !== undefined) {
			refuse("translation-invalid", unit.problem);
			continue;
		}
		if (unit.target === undefined || unit.target.length === 0) continue;
		if (now === undefined) {
			refuse(
				"translation-stale",
				`no message has the unit ${unit.id} any more. Export again.`,
			);
			continue;
		}
		const source = resolved(unit.source, codesOf(now.source));
		if (
			source === undefined ||
			piecesPattern(source) !== piecesPattern(now.source)
		) {
			refuse(
				"translation-stale",
				`the unit's source is not the base text any more: ${piecesPattern(now.source)}. Export again.`,
			);
			continue;
		}
		// A translation may place any code of its message: `ru`'s `one` needs the count that English's does not.
		const translation = resolved(unit.target, keyCodes.get(now.key) ?? []);
		if (translation === undefined) {
			refuse(
				"translation-invalid",
				"the translation places a code its message does not have. Use only the source's codes.",
			);
			continue;
		}
		accepted.set(unit.id, translation);
	}
	const messages: [string, unknown][] = [];
	let units = 0;
	for (const [key, keyUnits] of byKey(current)) {
		const given = keyUnits.filter((unit) =>
			changes(unit, accepted.get(unit.id)),
		);
		// A message no unit changes is left as it is written.
		if (given.length === 0) continue;
		const value = mergedMessage(
			base,
			key,
			{ locale, value: target?.messages.get(key) },
			keyUnits,
			accepted,
		);
		const problem =
			value === undefined
				? incomplete(keyUnits, accepted)
				: invalid(value, key, base, locale);
		if (problem !== undefined) {
			refused.push({ key, unit: undefined, ...problem });
			continue;
		}
		messages.push([key, value]);
		units += given.length;
	}
	return { messages, units, refused };
}

/** The units a file gives once, and how many times it gives each other one, which is neither's to take. */
function givenOnce(returned: readonly ReturnedUnit[]): {
	once: ReturnedUnit[];
	repeated: Map<string, number>;
} {
	const times = new Map<string, number>();
	for (const { id } of returned) times.set(id, (times.get(id) ?? 0) + 1);
	return {
		once: returned.filter(({ id }) => times.get(id) === 1),
		repeated: new Map([...times].filter(([, count]) => count > 1)),
	};
}

/** Whether a unit's accepted translation differs from its current one. */
function changes(
	unit: Unit,
	translation: readonly Piece[] | undefined,
): boolean {
	return (
		translation !== undefined &&
		(unit.target === undefined ||
			piecesPattern(translation) !== piecesPattern(unit.target))
	);
}

function byKey(units: readonly Unit[]): Map<string, Unit[]> {
	const keys = new Map<string, Unit[]>();
	for (const unit of units)
		keys.set(unit.key, [...(keys.get(unit.key) ?? []), unit]);
	return keys;
}

function incomplete(
	units: readonly Unit[],
	accepted: ReadonlyMap<string, Piece[]>,
): Pick<Refusal, "code" | "detail"> {
	const missing = units.filter(
		(unit) => !accepted.has(unit.id) && unit.target === undefined,
	);
	return {
		code: "translation-incomplete",
		detail: `the message needs a translation of every form, and lacks ${missing.map((unit) => unit.id).join(", ")}.`,
	};
}

/**
 * Why a merged message cannot be the locale's: it does not compile, or shows other inputs than the
 * base, a placeholder lost or invented. An input it only chooses by is the locale's grammar.
 */
function invalid(
	value: unknown,
	key: string,
	base: Catalog,
	locale: string,
): Pick<Refusal, "code" | "detail"> | undefined {
	try {
		const inputs = [...shownInputs(parseMessage(locale, value))].sort();
		const expected = [
			...shownInputs(parseMessage(base.locale, base.messages.get(key))),
		].sort();
		if (inputs.join() === expected.join()) return undefined;
		return {
			code: "translation-invalid",
			detail: `the translation shows ${inputs.map((name) => `{${name}}`).join(", ") || "no input"}, where the base shows ${expected.map((name) => `{${name}}`).join(", ") || "none"}.`,
		};
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { code: "translation-invalid", detail: error.message };
	}
}
