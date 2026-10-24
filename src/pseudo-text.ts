/**
 * The text of a pseudo-locale, made from the base locale's messages: every letter accented, the
 * text about 35% longer, and each message in brackets. A page in it shows at a glance which text
 * does not come from the catalogs, which layout breaks with longer words, and where a text is cut.
 * Its placeholders and markup stay as the base writes them, so it renders as the base does.
 */

import { isRecord } from "./config.ts";

/** Each ASCII letter, accented: still readable, and plainly not the base's text. */
const accentedLetters = [
	..."åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ",
];
const accented = new Map(
	[..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(
		(letter, index) => [letter, accentedLetters[index] ?? letter],
	),
);
/** What the text grows by, and the words it grows with, so that it wraps as words do. */
const growth = 0.35;
const words = "one two three four five six seven eight nine ten".split(" ");

/** A message in the pseudo-locale: its text, or each variant's of a message that matches. */
export function pseudoValue(value: unknown): unknown {
	if (typeof value === "string") return pseudoPattern(value);
	if (!Array.isArray(value)) return value;
	return value.map((fields: unknown) =>
		isRecord(fields) && isRecord(fields.match)
			? { ...fields, match: pseudoMatch(fields.match) }
			: fields,
	);
}

function pseudoMatch(match: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(match).map(([keys, pattern]) => [
			keys,
			typeof pattern === "string" ? pseudoPattern(pattern) : pattern,
		]),
	);
}

/**
 * A pattern with its text accented and grown, in brackets. A placeholder or markup, `{…}`, and an
 * escape, `\{`, are kept as they are written.
 */
export function pseudoPattern(pattern: string): string {
	let text = "";
	let letters = 0;
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern.charAt(index);
		const close = character === "{" ? pattern.indexOf("}", index) : -1;
		if (character === "\\") {
			text += pattern.slice(index, index + 2);
			letters += 1;
			index += 1;
		} else if (close !== -1) {
			text += pattern.slice(index, close + 1);
			index = close;
		} else {
			text += accented.get(character) ?? character;
			letters += 1;
		}
	}
	return `[${text}${grownBy(Math.round(letters * growth))}]`;
}

/** Whole words, each after a space, as many as make up at least `length` characters. */
function grownBy(length: number): string {
	let grown = "";
	for (let index = 0; grown.length < length; index++) {
		grown += ` ${words[index % words.length]}`;
	}
	return grown;
}
