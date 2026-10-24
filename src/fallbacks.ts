import type { Catalog } from "./catalog.ts";
import type { GraiError } from "./error.ts";

/**
 * A config's `fallbacks`, checked: each locale that takes the messages it lacks from another locale
 * of its language, such as en-GB from en. Never from another language, whose words it would show,
 * and never for the base locale, whose catalog has every key.
 */
export function readFallbacks(
	value: Readonly<Record<string, unknown>>,
	locales: readonly string[],
	baseLocale: string,
	invalid: (detail: string) => GraiError,
): ReadonlyMap<string, string> {
	const fallbacks = new Map<string, string>();
	for (const [locale, fallback] of Object.entries(value)) {
		if (
			typeof fallback !== "string" ||
			!locales.includes(locale) ||
			!locales.includes(fallback)
		) {
			throw invalid(
				`"fallbacks" maps ${JSON.stringify(locale)} to ${JSON.stringify(fallback)}, but each must be one of "locales": ${locales.join(", ")}`,
			);
		}
		if (locale === baseLocale) {
			throw invalid(
				`"fallbacks" maps the base locale, ${locale}, which takes no fallback: its catalog has every key`,
			);
		}
		if (languageOf(locale) !== languageOf(fallback)) {
			throw invalid(
				`"fallbacks" maps "${locale}" to "${fallback}", another language, whose words ${locale} would show. A fallback is a locale of the same language, such as "en-GB" to "en"`,
			);
		}
		fallbacks.set(locale, fallback);
	}
	const loop = circle(fallbacks);
	if (loop !== undefined) {
		throw invalid(
			`"fallbacks" goes round in a circle: ${loop.map((locale) => `"${locale}"`).join(" → ")}. Each chain of fallbacks must end at a locale that has none`,
		);
	}
	return fallbacks;
}

/** A chain of fallbacks that comes back to a locale on it, if there is one, ending at that locale. */
function circle(fallbacks: ReadonlyMap<string, string>): string[] | undefined {
	for (const start of fallbacks.keys()) {
		const chain = [start];
		let next = fallbacks.get(start);
		while (next !== undefined && !chain.includes(next)) {
			chain.push(next);
			next = fallbacks.get(next);
		}
		if (next !== undefined) return [...chain, next];
	}
	return undefined;
}

function languageOf(locale: string): string {
	return new Intl.Locale(locale).language;
}

/** For each catalog, by its position, the position of the catalog it falls back to, if any. */
export function fallbackPositions(
	locales: readonly string[],
	fallbacks: ReadonlyMap<string, string>,
): readonly (number | undefined)[] {
	return locales.map((locale) => {
		const fallback = fallbacks.get(locale);
		return fallback === undefined ? undefined : locales.indexOf(fallback);
	});
}

/**
 * The catalog a locale's message for a key comes from: its own when it has the key, else the first
 * along its chain of fallbacks that does. Undefined when none has it.
 */
export function messageSource(
	key: string,
	index: number,
	catalogs: readonly Catalog[],
	fallbackOf: readonly (number | undefined)[],
): Catalog | undefined {
	for (
		let at: number | undefined = index;
		at !== undefined;
		at = fallbackOf[at]
	) {
		const catalog = catalogs[at];
		if (catalog?.messages.has(key)) return catalog;
	}
	return undefined;
}
