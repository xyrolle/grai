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

	/**
	 * The file's text from `from` to `to` as a parser of the file decoded it, `text`: Vue decodes a
	 * template's HTML entities (`&amp;`) before its expressions are read. Each stretch the file
	 * writes as it is keeps its place (`decodedPieces`).
	 */
	decoded(from: number, to: number, text: string): this {
		const raw = this.source.slice(from, to);
		this.pieces.push(...decodedPieces(raw, text, from, this.text.length));
		this.text += text;
		return this;
	}

	/** An expression of the file, as a statement of its own. */
	expression(from: number, to: number): this {
		return this.write("(\n").piece(from, to).write("\n);\n");
	}

	/** An expression of the file as a parser of the file decoded it (`decoded`), as a statement. */
	decodedExpression(from: number, to: number, text: string): this {
		return this.write("(\n").decoded(from, to, text).write("\n);\n");
	}

	code(lang: Lang): SourceCode {
		return { text: this.text, lang, pieces: this.pieces };
	}
}

/** An HTML entity as a parser may decode it: a character's number or a name, maybe ending in `;`. */
const entity = /&(?:#\d+|#[xX][\da-fA-F]+|[A-Za-z][A-Za-z\d]*);?/g;

/**
 * The pieces of `decoded`, a text a parser decoded from `raw`, the file's text from `from`, written
 * at `at`. The file's text is stretches and HTML entities, in turn. A stretch, or an entity the
 * parser left as it is, keeps its place. A run of entities the parser decoded is at the place of
 * the first, as long as the decoded text before the next stretch. So a stretch's ends are the
 * file's exactly, and an offset inside a decoded run is its first entity's. A text the stretches do
 * not line up with, which no decoding of entities alone makes, is one piece at `from`.
 */
export function decodedPieces(
	raw: string,
	decoded: string,
	from: number,
	at: number,
): Piece[] {
	const whole: Piece[] = [{ at, from, length: decoded.length }];
	if (raw === decoded) return whole;
	const parts: { start: number; end: number; entity: boolean }[] = [];
	let last = 0;
	for (const { index, 0: written } of raw.matchAll(entity)) {
		if (index > last) parts.push({ start: last, end: index, entity: false });
		parts.push({ start: index, end: index + written.length, entity: true });
		last = index + written.length;
	}
	if (last < raw.length)
		parts.push({ start: last, end: raw.length, entity: false });
	const pieces: Piece[] = [];
	let d = 0;
	for (let i = 0; i < parts.length; ) {
		const part = parts[i];
		if (part === undefined) break;
		const text = raw.slice(part.start, part.end);
		if (decoded.startsWith(text, d)) {
			pieces.push({ at: at + d, from: from + part.start, length: text.length });
			d += text.length;
			i += 1;
			continue;
		}
		if (!part.entity) return whole;
		let next = i;
		while (parts[next]?.entity === true) next += 1;
		const after = parts[next];
		const following =
			after === undefined ? "" : raw.slice(after.start, after.end);
		let length = after === undefined ? decoded.length - d : 1;
		if (length < 1) return whole;
		while (after !== undefined && !decoded.startsWith(following, d + length)) {
			length += 1;
			if (d + length > decoded.length) return whole;
		}
		pieces.push({ at: at + d, from: from + part.start, length });
		d += length;
		i = next;
	}
	return d === decoded.length ? pieces : whole;
}

/**
 * Where an offset of a module's text is in its file, or undefined in code grai wrote. An offset
 * where one piece ends and the next begins is the next's, as a run of decoded entities ends at its
 * first entity's place and the stretch after it begins at its own.
 */
export function fileOffset(code: SourceCode, at: number): number | undefined {
	let low = 0;
	let high = code.pieces.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const piece = code.pieces[middle];
		if (piece === undefined) return undefined;
		const end = piece.at + piece.length;
		if (at < piece.at) high = middle - 1;
		else if (at > end || (at === end && code.pieces[middle + 1]?.at === at))
			low = middle + 1;
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
