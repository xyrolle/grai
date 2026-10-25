/**
 * A pattern as a translator works on it: its words, and its placeholders and markup as codes to
 * place but not edit.
 */

import { type Part, parsePattern, placeholderEnd } from "./pattern.ts";

/** A code a translator places but does not edit: a placeholder, or markup. */
export type Code = {
	/** Unique within its unit, and the same for the same code in every export. */
	id: string;
	kind: "placeholder" | "open" | "close" | "standalone";
	/** The code as the catalog writes it, braces included. */
	source: string;
};

/** A piece of a unit's text: words, or a code. */
export type Piece = { text: string } | Code;

/**
 * A pattern's pieces: its text, unescaped, and each placeholder and markup as a code. A code's id
 * is its name, with `tag-` before a markup's, and `.2`, `.3` after a repeat; an opening tag and the
 * tag that closes it share one id.
 */
export function patternPieces(source: string): Piece[] {
	const pieces: Piece[] = [];
	const seen = new Map<string, number>();
	const open: string[] = [];
	const idOf = (name: string) => {
		const count = (seen.get(name) ?? 0) + 1;
		seen.set(name, count);
		return count === 1 ? name : `${name}.${count}`;
	};
	let text = "";
	const flush = () => {
		if (text !== "") pieces.push({ text: plain(text) });
		text = "";
	};
	for (let index = 0; index < source.length; index++) {
		const character = source.charAt(index);
		if (character === "\\" && "{}\\".includes(source.charAt(index + 1))) {
			text += source.slice(index, index + 2);
			index++;
			continue;
		}
		const close = character === "{" ? placeholderEnd(source, index) : -1;
		if (close === -1) {
			text += character;
			continue;
		}
		flush();
		const written = source.slice(index, close + 1);
		const [part] = parsePattern(written);
		pieces.push(codeOf(part, written, idOf, open));
		index = close;
	}
	flush();
	return pieces;
}

function codeOf(
	part: Part | undefined,
	source: string,
	idOf: (name: string) => string,
	open: string[],
): Code {
	if (part === undefined || part.type === "text") {
		throw new Error(
			`grai read ${source} as text, where a placeholder or markup was expected`,
		);
	}
	if (part.type === "variable")
		return { id: idOf(part.name), kind: "placeholder", source };
	if (part.type === "literal")
		return { id: idOf("literal"), kind: "placeholder", source };
	const tag = `tag-${part.name}`;
	if (part.type === "markup-start") {
		const id = idOf(tag);
		open.push(id);
		return { id, kind: "open", source };
	}
	if (part.type === "markup-end") {
		const opened = open.findLastIndex(
			(id) => id === tag || id.startsWith(`${tag}.`),
		);
		const id =
			opened === -1 ? idOf(tag) : (open.splice(opened, 1)[0] ?? idOf(tag));
		return { id, kind: "close", source };
	}
	return { id: idOf(tag), kind: "standalone", source };
}

/** Text as parsePattern reads it, its escapes undone. */
function plain(raw: string): string {
	return raw.replaceAll(/\\([{}\\])/g, "$1");
}

/** Pieces as a pattern: the text escaped where a brace or a backslash would be read, each code as written. */
export function piecesPattern(pieces: readonly Piece[]): string {
	return pieces
		.map((piece) =>
			"text" in piece ? piece.text.replaceAll(/[{}\\]/g, "\\$&") : piece.source,
		)
		.join("");
}
