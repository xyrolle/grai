/**
 * Applies an edit of a catalog file to its previous parse, parsing only the entries the edit
 * touched. A catalog laid out one entry per line (as editors and formatters write them) has a
 * line break and the same indent before each top-level key, and nowhere else, since a JSON string
 * holds no raw line break. The bytes the edit changed lie between two such entry starts, so only
 * that span is parsed, in the old file and in the new. Returns undefined whenever that cannot be
 * shown exactly, for the caller to parse the whole file. With the messages come the keys whose
 * message the edit added, changed or removed, and whether any key now starts on another line.
 */
export function editedMessages(
	previousBytes: Buffer,
	previous: ReadonlyMap<string, unknown>,
	bytes: Buffer,
):
	| { messages: Map<string, unknown>; keys: Set<string>; moved: boolean }
	| undefined {
	const indent = entryIndent(bytes);
	if (indent === undefined) return undefined;
	const marker = Buffer.from(`\n${indent}"`);
	const prefix = commonPrefix(previousBytes, bytes);
	if (prefix === 0) return undefined;
	const suffix = commonSuffix(previousBytes, bytes, prefix);
	const from = bytes.lastIndexOf(marker, prefix - 1);
	if (from === -1) return undefined;
	const to = spanEnd(bytes, marker, bytes.length - suffix);
	if (to === undefined) return undefined;
	const grown = bytes.length - previousBytes.length;
	const before = previousBytes.subarray(from + 1, to - grown);
	const after = bytes.subarray(from + 1, to);
	const removed = entries(before);
	const added = entries(after);
	if (removed === undefined || added === undefined) return undefined;
	const removedKeys = Object.keys(removed);
	const isPreviousSpan = removedKeys.every(
		(key) => previous.has(key) && sameJson(previous.get(key), removed[key]),
	);
	const duplicates = Object.keys(added).some(
		(key) => previous.has(key) && !Object.hasOwn(removed, key),
	);
	if (!isPreviousSpan || duplicates) return undefined;
	const messages = new Map(previous);
	for (const key of removedKeys) messages.delete(key);
	for (const [key, value] of Object.entries(added)) messages.set(key, value);
	const keys = new Set<string>();
	for (const key of [...removedKeys, ...Object.keys(added)]) {
		if (
			!(
				Object.hasOwn(removed, key) &&
				Object.hasOwn(added, key) &&
				sameJson(removed[key], added[key])
			)
		) {
			keys.add(key);
		}
	}
	// Keys keep their lines when the span keeps its keys, in order, and its number of lines.
	const moved =
		removedKeys.join("\0") !== Object.keys(added).join("\0") ||
		lineBreaks(before) !== lineBreaks(after);
	return { messages, keys, moved };
}

/** The whitespace before the first key, if the object's first key starts a line. */
function entryIndent(bytes: Buffer): string | undefined {
	const text = bytes.subarray(0, 256).toString("latin1");
	return /^\{\r?\n([ \t]*)"/.exec(text)?.[1];
}

/** Where the span of whole entries ends: at the next entry's start, or at the object's closing brace. */
function spanEnd(
	bytes: Buffer,
	marker: Buffer,
	unchangedFrom: number,
): number | undefined {
	const next = bytes.indexOf(marker, unchangedFrom);
	if (next !== -1) return next;
	const close = bytes.lastIndexOf("}");
	return close >= unchangedFrom ? close : undefined;
}

/** The entries of a span such as `\t"a": "x",\n\t"b": [...],`, or undefined if it is not whole entries. */
function entries(span: Buffer): Record<string, unknown> | undefined {
	const text = span.toString("utf8").trim().replace(/,$/, "");
	try {
		const value: unknown = JSON.parse(`{${text}}`);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? { ...value }
			: undefined;
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
