/**
 * The one module of grai's that parses JavaScript and TypeScript, through oxc's parser, the one
 * Vite's bundler is built on. It gives ESTree with offsets in the text's UTF-16, names with their
 * escapes read, the module's imports and exports, and the errors with their places. Every reader
 * of code goes through it, so no two read a text into different trees.
 */

import {
	type ParseResult,
	type ParserOptions,
	parseSync,
	rawTransferSupported,
	visitorKeys,
} from "oxc-parser";

export type * as ESTree from "oxc-parser";

/** The fields of each kind of node that hold its children, in source order, as oxc lists them. */
export const childFields: Readonly<Record<string, readonly string[]>> =
	visitorKeys;

/** The options a reader may choose: the language, and whether parentheses stay in the tree. */
export type ParseOptions = Pick<ParserOptions, "lang" | "preserveParens">;

/**
 * Whether the tree reaches JavaScript through raw transfer, a buffer it reads directly, which on
 * app B's scripts takes 0.6 s against 2.8 s as JSON. `rawTransferSupported` says whether the
 * platform has it; where it does not, JSON carries the same tree.
 */
const rawTransfer = rawTransferSupported();

/** A text's tree, module record and errors; its language is the file's, unless `lang` says. */
export function parse(
	file: string,
	text: string,
	options: ParseOptions = {},
): ParseResult {
	const transfer: ParserOptions & { experimentalRawTransfer: boolean } = {
		...options,
		experimentalRawTransfer: rawTransfer,
	};
	return parseSync(file, text, transfer);
}
