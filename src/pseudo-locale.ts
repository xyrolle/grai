/**
 * The config's pseudo-locale, compiled for development and tests beside the configured locales.
 * Its catalog is the base's, made into pseudo-locale text (`pseudo-text.ts`).
 */

import type { Catalog } from "./catalog.ts";
import type { Config } from "./config.ts";
import { pseudoValue } from "./pseudo-text.ts";

/**
 * The config and catalogs with the config's pseudo-locale after its locales, if it names one.
 * The previous catalogs, of a compile with it, spare remaking what the base's edit left alone.
 */
export function withPseudoLocale(
	config: Config,
	catalogs: readonly Catalog[],
	previous: readonly Catalog[] = [],
): { config: Config; catalogs: Catalog[] } {
	const { pseudoLocale: locale, locales, baseLocale } = config;
	const baseIndex = locales.indexOf(baseLocale);
	const base = catalogs[baseIndex];
	if (locale === undefined || base === undefined) {
		return { config, catalogs: [...catalogs] };
	}
	const last = previous.at(-1);
	const before = last?.locale === locale ? last : undefined;
	return {
		config: { ...config, locales: [...locales, locale] },
		catalogs: [
			...catalogs,
			pseudoCatalog(locale, base, before, previous[baseIndex]),
		],
	};
}

/**
 * The pseudo-locale's catalog, made from the base's, with the base's file for its errors. After an
 * edit of the base, only the keys the edit touched are made again, and the catalog says so, so the
 * compile looks at those keys alone.
 */
function pseudoCatalog(
	locale: string,
	base: Catalog,
	before: Catalog | undefined,
	baseBefore: Catalog | undefined,
): Catalog {
	if (before !== undefined && base === baseBefore) return before;
	const edit = base.edit;
	if (before === undefined || edit === undefined || edit.from !== baseBefore) {
		const messages = new Map<string, unknown>();
		for (const [key, value] of base.messages)
			messages.set(key, pseudoValue(value));
		return { locale, file: base.file, messages };
	}
	const messages = new Map(before.messages);
	for (const key of edit.keys) {
		const value = base.messages.get(key);
		if (value === undefined) messages.delete(key);
		else messages.set(key, pseudoValue(value));
	}
	const pseudoEdit = { from: before, keys: edit.keys, moved: false };
	return { locale, file: base.file, messages, edit: pseudoEdit };
}
