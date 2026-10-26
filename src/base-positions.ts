/** Where each key is in the base locale's catalog files, for the declaration maps. */

import type { Catalog, CatalogSource } from "./catalog.ts";
import { hasObjects } from "./catalog-keys.ts";
import { keyPositions, type Position } from "./declaration-maps.ts";

/**
 * Where each key starts in the base locale's catalog: in its one file, or, when its messages are
 * split across files, in the file the position names. `parts` are the catalogs of `sources`.
 */
export function basePositions(
	sources: readonly CatalogSource[],
	parts: readonly Catalog[],
	baseLocale: string,
): ReadonlyMap<string, Position> {
	const files = sources.flatMap((source, index) => {
		const catalog = parts[index];
		return source.locale === baseLocale && catalog !== undefined
			? [{ text: source.bytes.toString("utf8"), catalog }]
			: [];
	});
	const positionsIn = ({ text, catalog }: (typeof files)[number]) =>
		keyPositions(
			text,
			catalog.messages.keys(),
			hasObjects(catalog.paths.values()),
		);
	const [only] = files;
	if (files.length === 1 && only !== undefined) return positionsIn(only);
	const positions = new Map<string, Position>();
	files.forEach((file, index) => {
		for (const [key, [line, column]] of positionsIn(file)) {
			positions.set(key, [line, column, index]);
		}
	});
	return positions;
}

/** Whether the base catalog's keys can start on other lines than in the previous build's. */
export function basePositionsMoved(
	base: Catalog | undefined,
	previous: Catalog | undefined,
): boolean {
	if (base === previous) return false;
	return (
		base?.edit === undefined ||
		base.edit.from !== previous?.revision ||
		base.edit.moved
	);
}
