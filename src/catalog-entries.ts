/** A catalog's top-level entry, by offsets in its text: its key's string, and where its value ends. */
export type CatalogEntry = {
	key: string;
	keyStart: number;
	keyEnd: number;
	valueEnd: number;
};

/**
 * The top-level entries of a catalog's text, in order, `$schema` among them. The text is a JSON
 * object, as parsing the catalog has shown, so this only finds where each entry lies.
 */
export function catalogEntries(text: string): CatalogEntry[] {
	const entries: CatalogEntry[] = [];
	let index = skipSpace(text, text.indexOf("{") + 1);
	while (text[index] === '"') {
		const keyStart = index;
		const keyEnd = stringEnd(text, keyStart);
		const key: unknown = JSON.parse(text.slice(keyStart, keyEnd));
		const valueStart = skipSpace(text, skipSpace(text, keyEnd) + 1);
		const valueEnd = valueEndAt(text, valueStart);
		entries.push({ key: String(key), keyStart, keyEnd, valueEnd });
		index = skipSpace(text, valueEnd);
		if (text[index] === ",") index = skipSpace(text, index + 1);
	}
	return entries;
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
