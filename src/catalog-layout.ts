/** How each object of a catalog's text is laid out, and how a new entry takes that layout. */

import { catalogEntries } from "./catalog-entries.ts";

/**
 * How an object of a catalog is laid out, as the bytes it writes around its entries: before the
 * first, between a key and its value, between two entries, and after the last.
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

/** The layout of an object's text, or undefined for one without entries, which shows none. */
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

/** The layout of an object that an entry of `layout` holds: its entries one step further in. */
export function innerLayout(layout: Layout): Layout {
	const lineBreak = /\r?\n/.exec(layout.opening)?.[0];
	if (lineBreak === undefined) return layout;
	const indent = indentOf(layout.opening);
	const inner = indent + stepOf(layout);
	return {
		opening: lineBreak + inner,
		colon: layout.colon,
		separator: `,${lineBreak}${inner}`,
		closing: lineBreak + indent,
	};
}

export function entryText(key: string, value: unknown, layout: Layout): string {
	return JSON.stringify(key) + layout.colon + valueText(value, layout);
}

/**
 * A value as the layout writes it: on the entry's line and the lines after it, indented one step
 * more than the entry for each level, with the layout's line break; on one line in a catalog that
 * is on one line.
 */
export function valueText(value: unknown, layout: Layout): string {
	const lineBreak = /\r?\n/.exec(layout.opening)?.[0];
	if (lineBreak === undefined) return JSON.stringify(value);
	return JSON.stringify(value, null, stepOf(layout)).replaceAll(
		"\n",
		lineBreak + indentOf(layout.opening),
	);
}

/** The indent after the last line break of a layout's bytes. */
function indentOf(bytes: string): string {
	return bytes.slice(bytes.lastIndexOf("\n") + 1);
}

/** One level of indent: what an object's entries have more than its closing brace. */
function stepOf(layout: Layout): string {
	const indent = indentOf(layout.opening);
	const outer = indentOf(layout.closing);
	return indent.startsWith(outer) && indent.length > outer.length
		? indent.slice(outer.length)
		: indent;
}
