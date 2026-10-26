/**
 * The code a scan passed, comments left out, and what its last tokens say about the character
 * after them: whether a `/` there starts a regular expression, and whether a string there is a
 * module's path or names a member. A token is a word, a literal, or one character. The scan notes
 * the code it passes as spans, and the tokens are read from them only where a question needs them.
 */

/** A token, and where it starts. */
type Token = { text: string; at: number };

/** The code a scan passed, as its last spans, newest last: code, or one literal. */
export type Passed = {
	readonly source: string;
	readonly spans: { from: number; to: number; literal: boolean }[];
};

/** The text a literal stands as among the tokens, which no word or character is. */
const literalToken = '"…"';

/** How many spans the scan keeps: each holds a token, and seven read `. import . meta . glob (`. */
const kept = 7;

/** Words after which an expression starts, so that a `/` opens a regular expression. */
const beforeExpression = new Set([
	"return",
	"typeof",
	"instanceof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"yield",
	"await",
]);

/** Nothing passed yet in a source. */
export function passedNothing(source: string): Passed {
	return { source, spans: [] };
}

/** Notes the code from `from` to `to` as passed, unless it is only space. */
export function passCode(passed: Passed, from: number, to: number): void {
	let end = to;
	while (end > from && isSpace(passed.source.charCodeAt(end - 1))) end--;
	if (end > from) note(passed, { from, to: end, literal: false });
}

/** Notes a literal, which starts at `at`, as passed. */
export function passLiteral(passed: Passed, at: number): void {
	note(passed, { from: at, to: at + 1, literal: true });
}

function note(passed: Passed, span: Passed["spans"][number]): void {
	passed.spans.push(span);
	if (passed.spans.length > kept) passed.spans.shift();
}

/** The last `count` tokens passed, newest first. */
function lastTokens(passed: Passed, count: number): Token[] {
	const { source, spans } = passed;
	const tokens: Token[] = [];
	for (let index = spans.length - 1; index >= 0; index--) {
		const span = spans[index];
		if (span === undefined || tokens.length === count) break;
		if (span.literal) {
			tokens.push({ text: literalToken, at: span.from });
			continue;
		}
		let end = span.to;
		while (tokens.length < count) {
			while (end > span.from && isSpace(source.charCodeAt(end - 1))) end--;
			if (end === span.from) break;
			let start = end - 1;
			if (isWordCode(source.charCodeAt(start))) {
				while (start > span.from && isWordCode(source.charCodeAt(start - 1))) {
					start--;
				}
			}
			tokens.push({ text: source.slice(start, end), at: start });
			end = start;
		}
	}
	return tokens;
}

/**
 * Whether a `/` after the code passed starts a regular expression: at the start, after a keyword
 * before an expression, or after an operator. After an operand, a `)`, a `]` or a `}` it divides.
 * After `<` it closes a JSX element.
 */
export function startsRegex(passed: Passed): boolean {
	const [previous] = lastTokens(passed, 1);
	if (previous === undefined || beforeExpression.has(previous.text))
		return true;
	if (isWord(previous.text) || previous.text === literalToken) return false;
	return !`)]}<"'\``.includes(previous.text);
}

/**
 * Whether a literal after the code passed is a module's path: after `from` or `import`, or in the
 * call of a dynamic import or a Vite glob, `import(` or `import.meta.glob(`.
 */
export function isPathAfter(passed: Passed): boolean {
	const [previous] = lastTokens(passed, 1);
	if (previous?.text === "from" || previous?.text === "import") return true;
	if (previous?.text !== "(") return false;
	const [, callee, beforeCallee] = lastTokens(passed, 3);
	if (callee?.text === "import") return beforeCallee?.text !== ".";
	if (callee?.text !== "glob") return false;
	const texts = lastTokens(passed, 7).map(({ text }) => text);
	return (
		texts.slice(1, 6).join(" ") === "glob . meta . import" && texts[6] !== "."
	);
}

/** Whether a string after the code passed is in brackets, as the index of `m["key"]` is. */
export function isIndexAfter(passed: Passed): boolean {
	const [previous] = lastTokens(passed, 1);
	return previous?.text === "[";
}

function isWord(text: string): boolean {
	return isWordCode(text.charCodeAt(0));
}

/** A character of a word, as `\w` and `$` are: a Latin letter, a digit, `_` or `$`. */
function isWordCode(code: number): boolean {
	return (
		(code >= 0x61 && code <= 0x7a) ||
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x30 && code <= 0x39) ||
		code === 0x5f ||
		code === 0x24
	);
}

/** Whether a character is space, as `\s` matches. */
function isSpace(code: number): boolean {
	if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true;
	return code > 0x7f && /\s/.test(String.fromCharCode(code));
}
