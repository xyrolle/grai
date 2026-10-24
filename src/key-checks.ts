/**
 * The checks a key passes before its messages are compiled: it is a JavaScript identifier, it
 * differs from every other key by more than case, and every locale has it.
 */

import type { Catalog } from "./catalog.ts";
import { GraiError } from "./error.ts";

const keyName = /^[A-Za-z_$][\w$]*$/;
/** Words a module cannot bind as an export's name. */
const reservedWords = new Set(
	"arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
		" ",
	),
);

/** Each key that differs from another only in case, with that other key. */
export function caseCollisions(keys: Iterable<string>): Map<string, string> {
	const seen = new Map<string, string>();
	const collisions = new Map<string, string>();
	for (const key of keys) {
		const folded = key.toLowerCase();
		const other = seen.get(folded);
		if (other === undefined) {
			seen.set(folded, key);
		} else {
			collisions.set(key, other);
			collisions.set(other, key);
		}
	}
	return collisions;
}

/** Whether a key can name a message: a JavaScript identifier that is not a reserved word. */
export function isKeyName(key: string): boolean {
	return keyName.test(key) && !reservedWords.has(key);
}

/** Whether a key can be compiled at all: a key name, colliding with no other, in every locale. */
export function isCompilable(
	key: string,
	values: readonly unknown[],
	collisions: ReadonlyMap<string, string>,
): boolean {
	return isKeyName(key) && !collisions.has(key) && !values.includes(undefined);
}

/** Why a key cannot be compiled at all: it is no identifier, collides with another, or a locale lacks it. */
export function keyProblems(
	key: string,
	catalogs: readonly Catalog[],
	values: readonly unknown[],
	collisions: ReadonlyMap<string, string>,
): GraiError[] {
	const file =
		catalogs.find((catalog) => catalog.messages.has(key))?.file ?? "";
	if (!isKeyName(key)) {
		return [
			new GraiError(
				"key-invalid",
				{ file, key },
				"a key must be a JavaScript identifier and not a reserved word, as it is the message's export name. Use letters, digits, _ and $.",
			),
		];
	}
	const collision = collisions.get(key);
	if (collision !== undefined) {
		return [
			new GraiError(
				"key-invalid",
				{ file, key },
				`the key differs from "${collision}" only in case, which a case-insensitive file system cannot tell apart. Rename one.`,
			),
		];
	}
	const present = catalogs.filter((_, index) => values[index] !== undefined);
	return catalogs
		.filter((_, index) => values[index] === undefined)
		.map(
			(catalog) =>
				new GraiError(
					"key-missing",
					{ file: catalog.file, key, locale: catalog.locale },
					`the key is in ${present.map((other) => other.locale).join(", ")} but not in ${catalog.locale}. Add it to every catalog, or remove it from all.`,
				),
		);
}
