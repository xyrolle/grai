/**
 * The config's `catalogs`: a path with `{locale}` in it, or a list of such paths, where a locale's
 * messages are split across files. A key is in one of its locale's files, and a new key goes in
 * the first.
 */

import { resolve } from "node:path";
import type { GraiError } from "./error.ts";

const localePlaceholder = "{locale}";

/** A locale's catalog files, the first being where a new key goes. */
export type CatalogPaths = readonly [first: string, ...others: string[]];

/**
 * Each locale's catalog files, absolute, in the order `catalogs` lists them. Two paths that come
 * to one file are refused, as a key would be in both.
 */
export function readCatalogPaths(
	value: unknown,
	locales: readonly string[],
	root: string,
	invalid: (detail: string) => GraiError,
): ReadonlyMap<string, CatalogPaths> {
	const patterns = typeof value === "string" ? [value] : value;
	const refused = () =>
		invalid(
			`"catalogs" must be a path with ${localePlaceholder} in it, such as "messages/${localePlaceholder}.json", or a list of distinct such paths, where a locale's messages are split across files`,
		);
	if (!isPatternList(patterns)) throw refused();
	const [first, ...others] = patterns;
	const paths = new Map(
		locales.map((locale): [string, CatalogPaths] => {
			const pathOf = (pattern: string) =>
				resolve(root, pattern.replaceAll(localePlaceholder, locale));
			return [locale, [pathOf(first), ...others.map(pathOf)]];
		}),
	);
	const files = new Set([...paths.values()].flat());
	if (files.size !== locales.length * patterns.length) throw refused();
	return paths;
}

function isPatternList(
	value: unknown,
): value is readonly [string, ...string[]] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(item) => typeof item === "string" && item.includes(localePlaceholder),
		)
	);
}
