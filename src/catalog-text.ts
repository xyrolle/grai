/** Editing a catalog's text: an entry the edit leaves alone keeps every byte. */

import type { CatalogEntry } from "./catalog-entries.ts";

/** The text with one entry's key renamed, and every other byte as it was. */
export function withKeyRenamed(
	text: string,
	entry: CatalogEntry,
	key: string,
): string {
	return (
		text.slice(0, entry.keyStart) +
		JSON.stringify(key) +
		text.slice(entry.keyEnd)
	);
}

/**
 * The text without the entries of the keys, each with the separator before it: the entries kept
 * stay as written, each after the separator it had, so the layout and final line break stay too.
 */
export function withoutEntries(
	text: string,
	entries: readonly CatalogEntry[],
	keys: ReadonlySet<string>,
): string {
	const [first] = entries;
	const last = entries.at(-1);
	if (first === undefined || last === undefined) return text;
	let kept = 0;
	let result = text.slice(0, first.keyStart);
	entries.forEach((entry, index) => {
		if (keys.has(entry.key)) return;
		const previous = entries[index - 1];
		if (kept > 0 && previous !== undefined) {
			result += text.slice(previous.valueEnd, entry.keyStart);
		}
		result += text.slice(entry.keyStart, entry.valueEnd);
		kept++;
	});
	return result + text.slice(last.valueEnd);
}
