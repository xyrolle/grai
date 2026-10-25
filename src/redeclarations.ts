/**
 * Where a file declares a name again, beside the import that binds it: as a variable, a function
 * or class, a parameter or a caught error, destructured or not. Where it does, the text alone
 * cannot tell which of the two a use of the name reads, so a command that changes uses refuses.
 * It errs towards finding one: a name it takes for a declaration only stops a rename.
 */

import { type MessageBindings, statementAt } from "./message-imports.ts";
import { after, before, nameEndingAt, occurrencesOf } from "./sources.ts";

/** The words that declare the name after them. */
const declaringWords = new Set(["const", "let", "var", "function", "class"]);
/** The words a `(` follows that opens a condition or a loop, not a list of parameters. */
const controlWords = new Set([
	"if",
	"for",
	"while",
	"switch",
	"with",
	"return",
]);
/** After a list of parameters: an optional return type, then a function's body or an arrow. */
const afterParameters = /^\s*(?::[^={;]*)?(?:=>|\{)/;
/** A destructuring declaration's pattern up to the name: `const { a, ` or `let [a, `. */
const destructuring = /\b(?:const|let|var)\s*[{[][^=;]*$/;
/** How far back a declaration's start or a list's `(` is looked for. */
const reach = 500;

/** Each offset at which the file declares the name again, outside its import statements. */
export function redeclarations(
	text: string,
	name: string,
	bindings: MessageBindings,
): number[] {
	return occurrencesOf(text, name).filter(
		(at) =>
			statementAt(bindings, at) === undefined && declaresAt(text, at, name),
	);
}

/** Whether the name at `at` is declared there, rather than read. */
export function declaresAt(text: string, at: number, name: string): boolean {
	const previous = before(text, at);
	if (text[previous] === ".") return false;
	const word = nameEndingAt(text, previous);
	if (declaringWords.has(word)) return true;
	if (text.startsWith("=>", after(text, at + name.length))) return true;
	const start = Math.max(0, at - reach);
	if (destructuring.test(text.slice(start, at))) return true;
	return inParameters(text, at);
}

/** Whether an offset lies in a list of parameters: of a function, a method, an arrow or a catch. */
function inParameters(text: string, at: number): boolean {
	const open = openingParenthesis(text, at);
	if (open === undefined) return false;
	const word = nameEndingAt(text, before(text, open));
	if (word === "catch") return true;
	if (controlWords.has(word)) return false;
	const close = closingParenthesis(text, open);
	return (
		close !== undefined &&
		afterParameters.test(text.slice(close + 1, close + 1 + reach))
	);
}

/** The `(` of the innermost parentheses around an offset, within `reach`. */
function openingParenthesis(text: string, at: number): number | undefined {
	let depth = 0;
	for (let index = at - 1; index >= Math.max(0, at - reach); index--) {
		const char = text.charAt(index);
		if (char === ")") depth++;
		if (char === "(") {
			if (depth === 0) return index;
			depth--;
		}
	}
	return undefined;
}

/** The `)` that closes the `(` at `open`, within `reach`. */
function closingParenthesis(text: string, open: number): number | undefined {
	let depth = 0;
	for (let index = open; index < Math.min(text.length, open + reach); index++) {
		const char = text.charAt(index);
		if (char === "(") depth++;
		if (char === ")") {
			depth--;
			if (depth === 0) return index;
		}
	}
	return undefined;
}
