/**
 * A module's code as one text grai's parser reads. A script is its own file. A component's scripts,
 * template expressions and patterns are pieces of its file, joined by code grai writes that opens
 * the scopes its template opens (`{#each items as item}` becomes `((item) => { … })`), so the
 * parser reads them as one program and the scope reader resolves every name exactly. Each piece
 * keeps its place in the file, which every offset the readers report is taken back to.
 */

/** A language oxc parses. */
export type Lang = "js" | "jsx" | "ts" | "tsx";

/** A stretch of the text that is the file's, from `from` in the file, at `at` in the text. */
export type Piece = { at: number; from: number; length: number };

/** Why a file's code cannot be read, and where in the file. */
export type CodeError = { at: number; message: string };

/** A module's code: the text, its language, and the pieces of it that are the file's. */
export type SourceCode = {
	readonly text: string;
	readonly lang: Lang;
	readonly pieces: readonly Piece[];
};

/** A script file's code: its text as it is, in the language its extension names. */
export function scriptCode(path: string, text: string): SourceCode {
	return {
		text,
		lang: langOf(path),
		pieces: [{ at: 0, from: 0, length: text.length }],
	};
}

/**
 * A script's language by its extension. JavaScript is read with JSX, which it is a superset of
 * there: a `<` that would start JSX starts nothing else in JavaScript.
 */
export function langOf(path: string): Lang {
	if (/\.[cm]?ts$/.test(path)) return "ts";
	return path.endsWith(".tsx") ? "tsx" : "jsx";
}

/** Writes a module's code: pieces of the file, and the code between them that grai writes. */
export class CodeWriter {
	private text = "";
	private readonly pieces: Piece[] = [];
	/** The file's text, which the pieces are of. */
	readonly source: string;

	constructor(source: string) {
		this.source = source;
	}

	/** Code grai writes, at no place of the file. */
	write(code: string): this {
		this.text += code;
		return this;
	}

	/** The file's text from `from` to `to`, kept at its place. */
	piece(from: number, to: number): this {
		this.pieces.push({ at: this.text.length, from, length: to - from });
		this.text += this.source.slice(from, to);
		return this;
	}

	/** An expression of the file, as a statement of its own. */
	expression(from: number, to: number): this {
		return this.write("(\n").piece(from, to).write("\n);\n");
	}

	code(lang: Lang): SourceCode {
		return { text: this.text, lang, pieces: this.pieces };
	}
}

/** Where an offset of a module's text is in its file, or undefined in code grai wrote. */
export function fileOffset(code: SourceCode, at: number): number | undefined {
	let low = 0;
	let high = code.pieces.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const piece = code.pieces[middle];
		if (piece === undefined) return undefined;
		if (at < piece.at) high = middle - 1;
		else if (at > piece.at + piece.length) low = middle + 1;
		else return piece.from + at - piece.at;
	}
	return undefined;
}

/** The file offset of the piece nearest before an offset of the text, for a place in grai's code. */
export function nearestFileOffset(code: SourceCode, at: number): number {
	let nearest = 0;
	for (const piece of code.pieces) {
		if (piece.at > at) break;
		nearest = Math.min(piece.from + at - piece.at, piece.from + piece.length);
	}
	return nearest;
}
