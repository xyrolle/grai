import type { Catalog } from "./catalog.ts";
import { type CatalogKeys, catalogKeys } from "./catalog-keys.ts";
import { isRecord } from "./config.ts";

/**
 * Applies an edit of a catalog file to its previous parse, parsing only the entries the edit
 * touched. A catalog laid out one entry per line (as editors and formatters write them) has a
 * line break and the same indent before each top-level key, and nowhere else, since a JSON string
 * holds no raw line break. The bytes the edit changed lie between two such entry starts, so only
 * that span is parsed, in the old file and in the new, and the separators around it are checked:
 * a comma or the opening brace before it, and a comma at its end unless it closes the object.
 * Returns undefined whenever that cannot be shown exactly, for the caller to parse the whole file.
 * With the messages and their paths come the keys whose message the edit added, changed or
 * removed, and whether any key now starts on another line.
 */
export function editedMessages(
	previousBytes: Buffer,
	previous: Catalog,
	bytes: Buffer,
): (CatalogKeys & { keys: Set<string>; moved: boolean }) | undefined {
	const where = { file: previous.file, locale: previous.locale };
	const indent = entryIndent(bytes);
	if (indent === undefined) return undefined;
	const marker = Buffer.from(`\n${indent}"`);
	const prefix = commonPrefix(previousBytes, bytes);
	if (prefix === 0) return undefined;
	const suffix = commonSuffix(previousBytes, bytes, prefix);
	const from = bytes.lastIndexOf(marker, prefix - 1);
	if (from === -1 || !separatedBefore(bytes, from)) return undefined;
	const end = spanEnd(bytes, marker, bytes.length - suffix);
	if (end === undefined) return undefined;
	const { to, closesObject } = end;
	const grown = bytes.length - previousBytes.length;
	const before = previousBytes.subarray(from + 1, to - grown);
	const after = bytes.subarray(from + 1, to);
	const removed = spanKeys(before, closesObject, where);
	const added = spanKeys(after, closesObject, where);
	if (removed === undefined || added === undefined) return undefined;
	const isPreviousSpan = [...removed.messages].every(
		([key, value]) =>
			sameJson(previous.paths.get(key), removed.paths.get(key)) &&
			sameJson(previous.messages.get(key), value),
	);
	const duplicates = [...added.messages.keys()].some(
		(key) => previous.messages.has(key) && !removed.messages.has(key),
	);
	if (!isPreviousSpan || duplicates) return undefined;
	const messages = new Map(previous.messages);
	const paths = new Map(previous.paths);
	for (const key of removed.messages.keys()) {
		messages.delete(key);
		paths.delete(key);
	}
	for (const [key, value] of added.messages) messages.set(key, value);
	for (const [key, path] of added.paths) paths.set(key, path);
	const keys = new Set<string>();
	for (const key of [...removed.messages.keys(), ...added.messages.keys()]) {
		if (
			!(
				removed.messages.has(key) &&
				added.messages.has(key) &&
				sameJson(removed.messages.get(key), added.messages.get(key))
			)
		) {
			keys.add(key);
		}
	}
	// Keys keep their lines when the span keeps its keys, in order, and its number of lines.
	const moved =
		[...removed.messages.keys()].join("\0") !==
			[...added.messages.keys()].join("\0") ||
		lineBreaks(before) !== lineBreaks(after);
	return { messages, paths, keys, moved };
}

/** The whitespace before the first key, if the object's first key starts a line. */
function entryIndent(bytes: Buffer): string | undefined {
	const text = bytes.subarray(0, 256).toString("latin1");
	return /^\{\r?\n([ \t]*)"/.exec(text)?.[1];
}

const comma = ",".charCodeAt(0);
const openingBrace = "{".charCodeAt(0);
/** JSON's whitespace, by byte. */
const whitespace = new Set(
	[" ", "\t", "\n", "\r"].map((char) => char.charCodeAt(0)),
);

/** Whether the entry at a line break follows a comma or the object's opening brace. */
function separatedBefore(bytes: Buffer, lineBreak: number): boolean {
	let at = lineBreak - 1;
	while (at >= 0 && whitespace.has(bytes[at] ?? 0)) at--;
	return bytes[at] === comma || bytes[at] === openingBrace;
}

/**
 * Where the span of whole entries ends: at the next entry's start, or at the object's closing
 * brace, which `closesObject` tells.
 */
function spanEnd(
	bytes: Buffer,
	marker: Buffer,
	unchangedFrom: number,
): { to: number; closesObject: boolean } | undefined {
	const next = bytes.indexOf(marker, unchangedFrom);
	if (next !== -1) return { to: next, closesObject: false };
	const close = bytes.lastIndexOf("}");
	return close >= unchangedFrom ? { to: close, closesObject: true } : undefined;
}

/**
 * The keys of a span such as `\t"a": "x",\n\t"b": {...},`, or undefined if it is not whole
 * entries, or its keys are not valid ones, which a parse of the whole file reports. A span the
 * next entry follows ends with the comma between them; one that closes the object ends without.
 */
function spanKeys(
	span: Buffer,
	closesObject: boolean,
	where: { file: string; locale: string },
): CatalogKeys | undefined {
	const text = span.toString("utf8").trim();
	if (text.endsWith(",") === closesObject) return undefined;
	const entries = closesObject ? text : text.slice(0, -1);
	try {
		const value: unknown = JSON.parse(`{${entries}}`);
		return isRecord(value) ? catalogKeys(value, where) : undefined;
	} catch {
		return undefined;
	}
}

function lineBreaks(bytes: Buffer): number {
	let count = 0;
	for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, at + 1))
		count++;
	return count;
}

/** Bytes compared at once, natively, before the first differing chunk is searched byte by byte. */
const chunk = 4096;

/** The length of the bytes two buffers start with in common. */
function commonPrefix(a: Buffer, b: Buffer): number {
	const length = Math.min(a.length, b.length);
	let index = 0;
	while (
		index + chunk <= length &&
		a.compare(b, index, index + chunk, index, index + chunk) === 0
	) {
		index += chunk;
	}
	while (index < length && a[index] === b[index]) index++;
	return index;
}

/** The length of the bytes two buffers end with in common, not reaching into their common start. */
function commonSuffix(a: Buffer, b: Buffer, prefix: number): number {
	const length = Math.min(a.length, b.length) - prefix;
	let index = 0;
	while (
		index + chunk <= length &&
		a.compare(
			b,
			b.length - index - chunk,
			b.length - index,
			a.length - index - chunk,
			a.length - index,
		) === 0
	) {
		index += chunk;
	}
	while (index < length && a[a.length - 1 - index] === b[b.length - 1 - index])
		index++;
	return index;
}

/** Whether two values parsed from JSON are equal, without serializing them. */
export function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	)
		return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => sameJson(item, b[index]))
		);
	}
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every(
			(key) =>
				Object.hasOwn(b, key) &&
				sameJson(Reflect.get(a, key), Reflect.get(b, key)),
		)
	);
}
