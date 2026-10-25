/**
 * Editing a catalog's text, the one way every command writes a catalog: an entry the edit leaves
 * alone keeps every byte, and an entry it writes takes the layout of the object it is in.
 */

import { type CatalogEntry, catalogEntries } from "./catalog-entries.ts";
import { type KeyPath, keyOf, schemaKey } from "./catalog-keys.ts";
import {
	entryText,
	innerLayout,
	type Layout,
	layoutOf,
	valueText,
} from "./catalog-layout.ts";
import { isRecord } from "./config.ts";

/**
 * The text with each message set at its path. A message the object has takes its new value in
 * place, at its last entry, which is the one JSON reads; a new one goes after the last entry of
 * the object its path names, which is made when there is none. A message whose path runs through
 * a message, not an object, goes beside it under its whole key. Every byte the messages do not
 * change stays.
 */
export function withMessages(
	text: string,
	messages: Iterable<readonly [KeyPath, unknown]>,
	layout: Layout,
): string {
	const entries = catalogEntries(text);
	const read = new Map(entries.map((entry) => [entry.key, entry]));
	const { values, inner } = byName(text, read, messages);
	const replaced = new Map<string, string>();
	for (const [name, nested] of inner) {
		const entry = read.get(name);
		if (entry === undefined) {
			values.set(name, objectOf(nested));
			continue;
		}
		const object = text.slice(entry.valueStart, entry.valueEnd);
		const own = layoutOf(object) ?? innerLayout(layout);
		replaced.set(name, withMessages(object, nested, own));
	}
	for (const [name, value] of values) {
		if (read.has(name)) replaced.set(name, valueText(value, layout));
	}
	const added = [...values]
		.filter(([name]) => !read.has(name))
		.map(([name, value]) => entryText(name, value, layout));
	const last = entries.at(-1);
	if (last === undefined) return withFirstEntries(text, added, layout);
	const changed = [...read.values()]
		.filter(({ key }) => replaced.has(key))
		.toSorted((a, b) => a.valueStart - b.valueStart);
	let result = "";
	let at = 0;
	for (const entry of changed) {
		result +=
			text.slice(at, entry.valueStart) + (replaced.get(entry.key) ?? "");
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

/**
 * The messages by the name their path starts with: those this object holds, by their name, and
 * those of the objects in it, by the object's name with the rest of their paths.
 */
function byName(
	text: string,
	read: ReadonlyMap<string, CatalogEntry>,
	messages: Iterable<readonly [KeyPath, unknown]>,
): {
	values: Map<string, unknown>;
	inner: Map<string, [KeyPath, unknown][]>;
} {
	const values = new Map<string, unknown>();
	const inner = new Map<string, [KeyPath, unknown][]>();
	for (const [path, value] of messages) {
		const [name = "", ...rest] = path;
		const entry = read.get(name);
		if (rest.length === 0) values.set(name, value);
		else if (entry !== undefined && !isObject(text, entry)) {
			values.set(keyOf(path), value);
		} else {
			const nested = inner.get(name) ?? [];
			nested.push([rest, value]);
			inner.set(name, nested);
		}
	}
	return { values, inner };
}

/** An object without entries, with its first ones between its braces. */
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
 * The text without the messages of the keys, each entry with the separator before it, and
 * without an object of messages the removal leaves empty. The entries kept stay as written, each
 * after the separator it had, so the layout and final line break stay too.
 */
export function withoutKeys(
	text: string,
	keys: ReadonlySet<string>,
	within: KeyPath = [],
): string {
	const entries = catalogEntries(text);
	const removed = new Set<CatalogEntry>();
	const replaced = new Map<CatalogEntry, string>();
	for (const entry of entries) {
		if (within.length === 0 && entry.key === schemaKey) continue;
		const path = [...within, entry.key];
		if (!isObject(text, entry)) {
			if (keys.has(keyOf(path))) removed.add(entry);
			continue;
		}
		const object = text.slice(entry.valueStart, entry.valueEnd);
		const kept = withoutKeys(object, keys, path);
		if (kept === object) continue;
		if (catalogEntries(kept).length === 0) removed.add(entry);
		else replaced.set(entry, kept);
	}
	return withEntriesKept(text, entries, removed, replaced);
}

/** The text without the `removed` entries, each with the separator before it, some values replaced. */
function withEntriesKept(
	text: string,
	entries: readonly CatalogEntry[],
	removed: ReadonlySet<CatalogEntry>,
	replaced: ReadonlyMap<CatalogEntry, string>,
): string {
	const [first] = entries;
	const last = entries.at(-1);
	if (first === undefined || last === undefined) return text;
	let kept = 0;
	let result = text.slice(0, first.keyStart);
	entries.forEach((entry, index) => {
		if (removed.has(entry)) return;
		const previous = entries[index - 1];
		if (kept > 0 && previous !== undefined) {
			result += text.slice(previous.valueEnd, entry.keyStart);
		}
		const value = replaced.get(entry);
		result +=
			value === undefined
				? text.slice(entry.keyStart, entry.valueEnd)
				: text.slice(entry.keyStart, entry.valueStart) + value;
		kept++;
	});
	return result + text.slice(last.valueEnd);
}

function isObject(text: string, entry: CatalogEntry): boolean {
	return text[entry.valueStart] === "{";
}

/** Messages by the rest of their paths, as the object of messages that holds them. */
function objectOf(
	messages: readonly (readonly [KeyPath, unknown])[],
): Record<string, unknown> {
	const object: Record<string, unknown> = {};
	for (const [path, value] of messages) {
		let at = object;
		for (const name of path.slice(0, -1)) {
			const next = at[name];
			const inner = isRecord(next) ? next : {};
			at[name] = inner;
			at = inner;
		}
		at[path.at(-1) ?? ""] = value;
	}
	return object;
}
