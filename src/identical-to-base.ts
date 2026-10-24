/**
 * The config's `identicalToBase`: per locale, the keys whose message rightly reads as the base
 * locale's, such as a unit, a code or a word both languages share. Such a message equals its seed
 * and is translated all the same, so the untranslated keys leave it out.
 */

import type { GraiError } from "./error.ts";

/** Each locale's keys whose message is the base text on purpose. */
export type IdenticalToBase = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * A config's `identicalToBase`, checked: each locale it names is one of the locales other than the
 * base, with a list of distinct keys. Whether the catalogs have those keys is `grai check`'s to say.
 */
export function readIdenticalToBase(
	value: Readonly<Record<string, unknown>>,
	locales: readonly string[],
	baseLocale: string,
	invalid: (detail: string) => GraiError,
): IdenticalToBase {
	const identical = new Map<string, ReadonlySet<string>>();
	for (const [locale, keys] of Object.entries(value)) {
		if (!locales.includes(locale)) {
			throw invalid(
				`"identicalToBase" names ${JSON.stringify(locale)}, which is not one of "locales": ${locales.join(", ")}`,
			);
		}
		if (locale === baseLocale) {
			throw invalid(
				`"identicalToBase" names the base locale, ${locale}, whose messages are the base text itself`,
			);
		}
		if (!isKeyList(keys)) {
			throw invalid(
				`"identicalToBase" must give ${locale} a list of distinct keys, such as ["unit_km"]`,
			);
		}
		identical.set(locale, new Set(keys));
	}
	return identical;
}

function isKeyList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every((key) => typeof key === "string") &&
		new Set(value).size === value.length
	);
}
