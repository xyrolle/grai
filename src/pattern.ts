import { type Format, parseFormat } from "./format-options.ts";
import { type MarkupPart, parseMarkup } from "./markup.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A piece of a message's text: words, a placeholder, a literal, or markup the app draws. A
 * placeholder that calls a formatting function, such as `{count :number}`, has its format, and so
 * does a literal, such as `{|1000| :number}`; a literal without one, `{|Gmail|}`, is its text.
 */
export type Part =
	| { type: "text"; value: string }
	| { type: "variable"; name: string; format?: Format }
	| LiteralPart
	| MarkupPart;

/** A literal in braces, kept apart from the words around it, so a translator sees it as a code. */
export type LiteralPart = { type: "literal"; value: string; format?: Format };

/** Whether a part is markup, for the app to draw. */
export function isMarkup(part: Part): part is MarkupPart {
	return part.type.startsWith("markup-");
}

/** MessageFormat 2's number-literal, such as `0`, `-2`, `1.5` or `1e+21`. */
const numberLiteral = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/** Whether text is a MessageFormat 2 number-literal. */
export function isNumberLiteral(text: string): boolean {
	return numberLiteral.test(text);
}

/** A name a placeholder, a declaration or a selector can give an input or a local. */
export const identifier: RegExp = /^[A-Za-z_$][\w$]*$/;
/** A placeholder calling a function, as `{count :number}` or as a declaration writes it, `{count: number}`. */
const call = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z]\w*)(\s.*)?$/;
/** A literal, quoted (`|1000|`, where `\` escapes the next character) or a number, maybe with a function. */
const literalCall =
	/^(?:\|((?:[^|\\]|\\.)*)\||(-?\d[\w.+-]*))\s*(?::\s*([A-Za-z]\w*)(\s.*)?)?$/s;
const escapable = new Set(["{", "}", "\\"]);

/**
 * Parses the inlang message format's pattern syntax. `\{`, `\}` and `\\` are escapes, a `{` that
 * is never closed is text, and anything in braces that is not a placeholder or markup is an error.
 */
export function parsePattern(source: string): Part[] {
	if (!source.includes("{") && !source.includes("\\")) {
		return source === "" ? [] : [{ type: "text", value: source }];
	}
	const parts: Part[] = [];
	let text = "";
	for (let index = 0; index < source.length; index++) {
		const char = source.charAt(index);
		const next = source.charAt(index + 1);
		if (char === "\\" && escapable.has(next)) {
			text += next;
			index++;
			continue;
		}
		const close = char === "{" ? placeholderEnd(source, index) : -1;
		if (close === -1) {
			text += char;
			continue;
		}
		if (text !== "") parts.push({ type: "text", value: text });
		text = "";
		parts.push(placeholder(source.slice(index + 1, close)));
		index = close;
	}
	if (text !== "") parts.push({ type: "text", value: text });
	return parts;
}

/**
 * The index of the `}` that closes the placeholder or markup a `{` opens, or -1 when none does. A
 * `}` in a quoted value, `|a}b|`, where `\` escapes the next character, is the value's text. When
 * a quote is never closed, the first `}` closes it, so the markup is read and its open quote named.
 */
export function placeholderEnd(source: string, open: number): number {
	let quoted = false;
	for (let index = open + 1; index < source.length; index++) {
		const char = source.charAt(index);
		if (quoted && char === "\\") index++;
		else if (char === "|") quoted = !quoted;
		else if (char === "}" && !quoted) return index;
	}
	return quoted ? source.indexOf("}", open + 1) : -1;
}

function placeholder(body: string): Part {
	if (identifier.test(body)) return { type: "variable", name: body };
	const markup = parseMarkup(body);
	if (markup !== undefined) return markup;
	const literal = literalPart(body);
	if (literal !== undefined) return literal;
	if (body.startsWith("|")) {
		throw new MessageProblem(
			"message-invalid",
			`{${body}}: a quoted literal is not closed by |.`,
		);
	}
	const [, name, fn, options = ""] = call.exec(body) ?? [];
	if (name !== undefined && fn !== undefined) {
		return {
			type: "variable",
			name,
			format: parseFormat(fn, options, `{${body}}`),
		};
	}
	if (body.includes(":")) {
		throw new MessageProblem(
			"unsupported",
			`the placeholder {${body}} calls a function on something other than an input or a literal, which grai does not support. Write it as {name :function} or {|literal| :function}.`,
		);
	}
	throw new MessageProblem(
		"message-invalid",
		`{${body}} is not a placeholder: a placeholder is a name such as {count}. Write a literal brace as \\{.`,
	);
}

/**
 * A literal placeholder, or undefined for a body that is none. A literal's function is one of
 * numbers or `:relativetime`, as a literal is read as a number: a date's or a list's text is not
 * one grai reads.
 */
function literalPart(body: string): LiteralPart | undefined {
	const [, quoted, number, fn, options = ""] = literalCall.exec(body) ?? [];
	const value = quoted?.replaceAll(/\\(.)/gs, "$1") ?? number;
	if (
		value === undefined ||
		(number !== undefined && !isNumberLiteral(number))
	) {
		return undefined;
	}
	if (fn === undefined) return { type: "literal", value };
	const format = parseFormat(fn, options, `{${body}}`);
	if (format.formatter !== "number" && format.formatter !== "relativetime") {
		throw new MessageProblem(
			"unsupported",
			`{${body}} formats a literal with :${fn}, which grai does not support: a literal operand is a number, for a number function or :relativetime. Pass the value as an input.`,
		);
	}
	if (!isNumberLiteral(value)) {
		throw new MessageProblem(
			"message-invalid",
			`{${body}}: "${value}" is not a number, which :${fn} formats.`,
		);
	}
	return { type: "literal", value, format };
}

/** Whether a pattern formats a literal, which only a function can do, as it is the locale's to format. */
export function formatsLiteral(pattern: readonly Part[]): boolean {
	return pattern.some((part) => part.type === "literal" && part.format);
}

/** The text a pattern shows with its markup drawn as nothing and no placeholders in it. */
export function plainText(pattern: readonly Part[]): string {
	let text = "";
	for (const part of pattern) {
		if (part.type === "text") text += part.value;
		else if (part.type === "literal" && part.format === undefined) {
			text += part.value;
		}
	}
	return text;
}
