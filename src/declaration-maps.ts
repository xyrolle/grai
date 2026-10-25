/**
 * Declaration maps: a shard's `.d.ts.map`, which takes an editor's go to definition from a key's
 * declaration to the key in the base locale's catalog.
 */

import { join, relative } from "node:path";
import { messageEntries } from "./catalog-entries.ts";
import { keyOf } from "./catalog-keys.ts";

/** Where something starts in a text: its line and its column, both from 0. */
export type Position = readonly [line: number, column: number];

/** A key, and the line of its shard's declarations its declaration is on. */
export type DeclarationLine = readonly [key: string, line: number];

/**
 * The base locale's catalog, for the declaration maps: its path, where each key is in it, and
 * whether that can differ from where the previous render had them.
 */
export type BaseCatalog = {
	path: string;
	positions: ReadonlyMap<string, Position>;
	moved: boolean;
};

/** Where a shard's declarations put each key's name: after `export declare const `. */
const nameColumn = "export declare const ".length;

/**
 * The map of a shard's declarations, `file` in `keys/`: the previous render's while the
 * declarations keep their file and their lines and the base catalog's keys keep theirs, else a new
 * one. TypeScript follows a map only when it names the declarations it maps.
 */
export function shardMap(
	file: string,
	lines: readonly DeclarationLine[],
	base: BaseCatalog,
	outdir: string,
	previous:
		| {
				file: string;
				map: string;
				lines: readonly DeclarationLine[];
		  }
		| undefined,
): string {
	if (
		previous !== undefined &&
		previous.file === file &&
		!base.moved &&
		sameLines(lines, previous.lines)
	) {
		return previous.map;
	}
	const catalog = relative(join(outdir, "keys"), base.path);
	return declarationMap(file, catalog, lines, base.positions, nameColumn);
}

/** Whether a shard's declarations are on the lines they were on in the previous render. */
function sameLines(
	lines: readonly DeclarationLine[],
	previous: readonly DeclarationLine[] | undefined,
): boolean {
	if (lines === previous) return true;
	if (previous?.length !== lines.length) return false;
	return lines.every(
		([key, line], index) =>
			previous[index]?.[0] === key && previous[index]?.[1] === line,
	);
}

/**
 * Where each key of a catalog starts, at the first character of its name. A catalog laid out one
 * entry per line has each top-level key at the start of a line, after the first key's indent; in a
 * catalog on one line, each key is found where its name is first written. A key in an object of
 * messages, when `nested` says the catalog has one, is found by the scan of its entries.
 *
 * `keys` are the catalog's keys as its parse holds them, mostly in the file's order. A key found
 * where the next of them is expected is stored under the parse's string, not a slice of the text:
 * the parse's strings are interned, so a lookup by a compiled key compares them in one step, where
 * comparing a slice reads it from the text and took most of the time the maps took.
 */
export function keyPositions(
	text: string,
	keys: Iterable<string> = [],
	nested = false,
): Map<string, Position> {
	const positions = topLevelPositions(text, keys);
	if (nested) {
		for (const [key, position] of nestedPositions(text)) {
			positions.set(key, position);
		}
	}
	return positions;
}

function topLevelPositions(
	text: string,
	keys: Iterable<string>,
): Map<string, Position> {
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
	const parsed = keys[Symbol.iterator]();
	let expected = parsed.next();
	let line = 0;
	for (let from = 0; from < text.length; line++) {
		const end = text.indexOf("\n", from);
		const next = end === -1 ? text.length : end + 1;
		if (text.startsWith(start, from)) {
			const name = from + start.length;
			let key: string;
			if (
				expected.done !== true &&
				text.startsWith(expected.value, name) &&
				text.charCodeAt(name + expected.value.length) === quote
			) {
				key = expected.value;
				expected = parsed.next();
			} else {
				key = text.slice(name, text.indexOf('"', name));
			}
			if (!positions.has(key)) positions.set(key, [line, start.length]);
		}
		from = next;
	}
	return positions;
}

const quote = 34;

/** Where the name of each key in an object of messages starts, from one pass over the text. */
function nestedPositions(text: string): Map<string, Position> {
	const positions = new Map<string, Position>();
	let line = 0;
	let lineStart = 0;
	let at = 0;
	for (const { path, keyStart } of messageEntries(text)) {
		for (; at < keyStart; at++) {
			if (text.charCodeAt(at) === lineFeed) {
				line++;
				lineStart = at + 1;
			}
		}
		if (path.length > 1) {
			positions.set(keyOf(path), [line, keyStart + 1 - lineStart]);
		}
	}
	return positions;
}

const lineFeed = 10;

/**
 * The declaration map of a shard's `.d.ts`: each declaration's name, at `column` of its line, to
 * its key's position in the catalog. `declarations` are each key with the line its declaration is
 * on, in order.
 */
export function declarationMap(
	file: string,
	catalog: string,
	declarations: readonly DeclarationLine[],
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
