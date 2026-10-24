/**
 * Editing a catalog's text, the one way every command writes a catalog: an entry the edit leaves
 * alone keeps every byte, and an entry it writes takes the catalog's own layout.
 */

import { type CatalogEntry, catalogEntries } from "./catalog-entries.ts";

/**
 * How a catalog is laid out, as the bytes it writes around its entries: before the first, between
 * a key and its value, between two entries, and after the last.
 */
export type Layout = {
	opening: string;
	colon: string;
	separator: string;
	closing: string;
};

/** The layout grai writes where no catalog shows one: an entry per line, indented by a tab. */
export const tabbedLayout: Layout = {
	opening: "\n\t",
	colon: ": ",
	separator: ",\n\t",
	closing: "\n",
};

/** The layout of a catalog's text, or undefined for a catalog without entries, which shows none. */
export function layoutOf(text: string): Layout | undefined {
	const entries = catalogEntries(text);
	const [first, second] = entries;
	const last = entries.at(-1);
	if (first === undefined || last === undefined) return undefined;
	const opening = text.slice(text.indexOf("{") + 1, first.keyStart);
	return {
		opening,
		colon: text.slice(first.keyEnd, first.valueStart),
		separator:
			second === undefined
				? `,${opening}`
				: text.slice(first.valueEnd, second.keyStart),
		closing: text.slice(last.valueEnd, text.lastIndexOf("}")),
	};
}

/**
 * The text with each message set. A key the catalog has takes its new value in place, at its last
 * entry, which is the one JSON reads; a new key goes after the last entry. Every byte the messages
 * do not change stays.
 */
export function withMessages(
	text: string,
	messages: Iterable<readonly [string, unknown]>,
	layout: Layout,
): string {
	const values = new Map(messages);
	const entries = catalogEntries(text);
	const read = new Map(entries.map((entry) => [entry.key, entry]));
	const added = [...values]
		.filter(([key]) => !read.has(key))
		.map(([key, value]) => entryText(key, value, layout));
	const last = entries.at(-1);
	if (last === undefined) return withFirstEntries(text, added, layout);
	const changed = [...read.values()]
		.filter(({ key }) => values.has(key))
		.toSorted((a, b) => a.valueStart - b.valueStart);
	let result = "";
	let at = 0;
	for (const entry of changed) {
		result += text.slice(at, entry.valueStart);
		result += valueText(values.get(entry.key), layout);
		at = entry.valueEnd;
	}
	const appended = added.map((entry) => layout.separator + entry).join("");
	return (
		result +
		text.slice(at, last.valueEnd) +
		appended +
		text.slice(last.valueEnd)
	);
}

/** A catalog without entries, with its first ones between its braces. */
function withFirstEntries(
	text: string,
	entries: readonly string[],
	layout: Layout,
): string {
	if (entries.length === 0) return text;
	const open = text.indexOf("{") + 1;
	const close = text.lastIndexOf("}");
	const body = entries.join(layout.separator);
	return (
		text.slice(0, open) +
		layout.opening +
		body +
		layout.closing +
		text.slice(close)
	);
}

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

function entryText(key: string, value: unknown, layout: Layout): string {
	return JSON.stringify(key) + layout.colon + valueText(value, layout);
}

/**
 * A value as the layout writes it: on the entry's line and the lines after it, indented one step
 * more than the entry for each level, with the layout's line break; on one line in a catalog that
 * is on one line.
 */
function valueText(value: unknown, layout: Layout): string {
	const lineBreak = /\r?\n/.exec(layout.opening)?.[0];
	if (lineBreak === undefined) return JSON.stringify(value);
	const indent = layout.opening.slice(layout.opening.lastIndexOf("\n") + 1);
	return JSON.stringify(value, null, indent).replaceAll(
		"\n",
		lineBreak + indent,
	);
}
