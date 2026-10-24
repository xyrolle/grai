/**
 * Declaration maps: a shard's `.d.ts.map`, which takes an editor's go to definition from a key's
 * declaration to the key in the base locale's catalog.
 */

/** Where something starts in a text: its line and its column, both from 0. */
export type Position = readonly [line: number, column: number];

/**
 * Where each top-level key of a catalog starts, at the first character of its name. A catalog laid
 * out one entry per line has each key at the start of a line, after the first key's indent; in a
 * catalog on one line, each key is found where its name is first written.
 */
export function keyPositions(text: string): Map<string, Position> {
	const positions = new Map<string, Position>();
	const indent = /^\{\r?\n([ \t]*)"/.exec(text)?.[1];
	if (indent === undefined) {
		for (const [, key = ""] of text.matchAll(/"([A-Za-z_$][\w$]*)"\s*:/g)) {
			if (!positions.has(key))
				positions.set(key, [0, text.indexOf(`"${key}"`) + 1]);
		}
		return positions;
	}
	const start = `${indent}"`;
	let line = 0;
	for (let from = 0; from < text.length; line++) {
		const end = text.indexOf("\n", from);
		const next = end === -1 ? text.length : end + 1;
		if (text.startsWith(start, from)) {
			const name = from + start.length;
			const key = text.slice(name, text.indexOf('"', name));
			if (!positions.has(key)) positions.set(key, [line, start.length]);
		}
		from = next;
	}
	return positions;
}

/**
 * The declaration map of a shard's `.d.ts`: each declaration's name, at `column` of its line, to
 * its key's position in the catalog. `declarations` are each key with the line its declaration is
 * on, in order.
 */
export function declarationMap(
	file: string,
	catalog: string,
	declarations: readonly (readonly [key: string, line: number])[],
	positions: ReadonlyMap<string, Position>,
	column: number,
): string {
	// Each segment starts at the name's column, in the one source; then come the deltas of the line
	// and the column in the catalog. A line without a declaration has no segment.
	const start = `${vlq(column)}A`;
	let mappings = "";
	let line = 0;
	let previous: Position = [0, 0];
	for (const [key, declared] of declarations) {
		const position = positions.get(key);
		if (position === undefined) continue;
		mappings += `${";".repeat(declared - line)}${start}${vlq(position[0] - previous[0])}${vlq(position[1] - previous[1])}`;
		line = declared;
		previous = position;
	}
	return `${JSON.stringify({ version: 3, file, sources: [catalog], names: [], mappings })}\n`;
}

/** The lines a text takes, counting the line its last line break ends. */
export function lineCount(text: string): number {
	let count = 0;
	for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1))
		count++;
	return count;
}

const base64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A number in a source map's base 64 variable-length quantity. */
function vlq(value: number): string {
	let rest = value < 0 ? (-value << 1) | 1 : value << 1;
	let digits = "";
	do {
		const digit = rest & 31;
		rest >>>= 5;
		digits += base64.charAt(rest > 0 ? digit | 32 : digit);
	} while (rest > 0);
	return digits;
}
