/**
 * A pattern as a translator works on it: its words, and its placeholders and markup as codes to
 * place but not edit.
 */

import { type Part, parsePattern, placeholderEnd } from "./pattern.ts";

/** A code a translator places but does not edit: a placeholder, or markup. */
export type Code = {
	/** The same for the same code in every unit of its message, and in every export. */
	id: string;
	kind: "placeholder" | "open" | "close" | "standalone";
	/** The code as the catalog writes it, braces included. */
	source: string;
};

/** A piece of a unit's text: words, or a code. */
export type Piece = { text: string } | Code;

/**
 * The ids of one message's codes, the same in all its units, so that an id names one code wherever
 * a file places it. A code gets an id of its own for each way it is written, and for each time one
 * pattern repeats it: its name, with `tag-` before a markup's, then `.2`, `.3` for the name's next
 * ones.
 */
export class CodeIds {
	private readonly ids = new Map<string, string>();
	private readonly names = new Map<string, number>();

	/** The id of a pattern's `nth` code written as `writing`, which is named `name`. */
	idOf(name: string, writing: string, nth: number): string {
		const identity = `${nth} ${writing}`;
		const known = this.ids.get(identity);
		if (known !== undefined) return known;
		const count = (this.names.get(name) ?? 0) + 1;
		this.names.set(name, count);
		const id = count === 1 ? name : `${name}.${count}`;
		this.ids.set(identity, id);
		return id;
	}
}

type CodePart = Exclude<Part, { type: "text" }>;

/** A piece as the pattern writes it: its text, unescaped, or a code before it has an id. */
type Written = { text: string } | { part: CodePart; source: string };

/**
 * A pattern's pieces: its text, unescaped, and each placeholder and markup as a code, its id taken
 * from the message's `ids`. An opening tag and the tag that closes it are one code, written as
 * both, and share its id.
 */
export function patternPieces(
	source: string,
	ids: CodeIds = new CodeIds(),
): Piece[] {
	const written = writtenPieces(source);
	const closers = closingTags(written);
	const closed = new Map<number, string>();
	const repeats = new Map<string, number>();
	return written.map((piece, index): Piece => {
		if ("text" in piece) return piece;
		const kind = kinds[piece.part.type];
		const pair = closed.get(index);
		if (pair !== undefined) return { id: pair, kind, source: piece.source };
		const closer = closers.get(index);
		const writing = piece.source + (closer?.source ?? "");
		const nth = (repeats.get(writing) ?? 0) + 1;
		repeats.set(writing, nth);
		const id = ids.idOf(nameOf(piece.part), writing, nth);
		if (closer !== undefined) closed.set(closer.index, id);
		return { id, kind, source: piece.source };
	});
}

const kinds: Readonly<Record<CodePart["type"], Code["kind"]>> = {
	variable: "placeholder",
	"markup-start": "open",
	"markup-end": "close",
	"markup-standalone": "standalone",
};

function nameOf(part: CodePart): string {
	return part.type === "variable" ? part.name : `tag-${part.name}`;
}

function writtenPieces(source: string): Written[] {
	const pieces: Written[] = [];
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
		if (part === undefined || part.type === "text") {
			throw new Error(
				`grai read ${written} as text, where a placeholder or markup was expected`,
			);
		}
		pieces.push({ part, source: written });
		index = close;
	}
	flush();
	return pieces;
}

/**
 * The tag that closes each opening tag, by the opening tag's index: the next one of its name that
 * no later opening tag takes first.
 */
function closingTags(
	pieces: readonly Written[],
): Map<number, { index: number; source: string }> {
	const closers = new Map<number, { index: number; source: string }>();
	const open: { index: number; name: string }[] = [];
	pieces.forEach((piece, index) => {
		if ("text" in piece) return;
		const { type, name } = piece.part;
		if (type === "markup-start") open.push({ index, name });
		if (type !== "markup-end") return;
		const at = open.findLastIndex((tag) => tag.name === name);
		const [opened] = at === -1 ? [] : open.splice(at, 1);
		if (opened !== undefined)
			closers.set(opened.index, { index, source: piece.source });
	});
	return closers;
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
