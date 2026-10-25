/** Where a catalog's entries lie in its text: the scan that every edit of a catalog's text reads. */

import { type KeyPath, schemaKey } from "./catalog-keys.ts";

/** An entry of an object in a catalog's text, by offsets in the text: its key's string, and its value. */
export type CatalogEntry = {
	key: string;
	keyStart: number;
	keyEnd: number;
	valueStart: number;
	valueEnd: number;
};

/**
 * The entries of the object at `open` in a catalog's text, by default the catalog's own, in order,
 * `$schema` among them. The text is a JSON object, as parsing the catalog has shown, so this only
 * finds where each entry lies.
 */
export function catalogEntries(
	text: string,
	open: number = text.indexOf("{"),
): CatalogEntry[] {
	const entries: CatalogEntry[] = [];
	let index = skipSpace(text, open + 1);
	while (text[index] === '"') {
		const keyStart = index;
		const keyEnd = stringEnd(text, keyStart);
		const key: unknown = JSON.parse(text.slice(keyStart, keyEnd));
		const valueStart = skipSpace(text, skipSpace(text, keyEnd) + 1);
		const valueEnd = valueEndAt(text, valueStart);
		entries.push({ key: String(key), keyStart, keyEnd, valueStart, valueEnd });
		index = skipSpace(text, valueEnd);
		if (text[index] === ",") index = skipSpace(text, index + 1);
	}
	return entries;
}

/** A message's entry, at any depth of a catalog's text: the path of names it is at, and its offsets. */
export type MessageEntry = CatalogEntry & { path: KeyPath };

/**
 * Every message's entry in a catalog's text, in order, the objects of messages opened, as
 * `catalogKeys` opens them in its parse.
 */
export function messageEntries(
	text: string,
	open: number = text.indexOf("{"),
	within: KeyPath = [],
): MessageEntry[] {
	return catalogEntries(text, open).flatMap((entry) => {
		if (within.length === 0 && entry.key === schemaKey) return [];
		const path = [...within, entry.key];
		return text[entry.valueStart] === "{"
			? messageEntries(text, entry.valueStart, path)
			: [{ ...entry, path }];
	});
}

const whitespace = " \t\r\n";

function skipSpace(text: string, at: number): number {
	let index = at;
	while (index < text.length && whitespace.includes(text.charAt(index))) {
		index++;
	}
	return index;
}

/** The offset after a JSON string that starts at `start`. */
function stringEnd(text: string, start: number): number {
	let index = start + 1;
	while (index < text.length && text[index] !== '"') {
		index += text[index] === "\\" ? 2 : 1;
	}
	return index + 1;
}

/** The offset after a JSON value that starts at `start`. */
function valueEndAt(text: string, start: number): number {
	if (text[start] === '"') return stringEnd(text, start);
	let depth = 0;
	let index = start;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === '"') {
			index = stringEnd(text, index);
			continue;
		}
		if (char === "{" || char === "[") depth++;
		if (char === "}" || char === "]") {
			if (depth === 0) return index;
			depth--;
			if (depth === 0) return index + 1;
		}
		if (depth === 0 && (char === "," || whitespace.includes(char))) {
			return index;
		}
		index++;
	}
	return index;
}
