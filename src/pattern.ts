import { type Format, parseFormat } from "./format-options.ts";
import { type MarkupPart, parseMarkup } from "./markup.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A piece of a message's text: words, a placeholder, or markup the app draws. A placeholder that
 * calls a formatting function, such as `{count :number}`, has its format.
 */
export type Part =
	| { type: "text"; value: string }
	| { type: "variable"; name: string; format?: Format }
	| MarkupPart;

const identifier = /^[A-Za-z_$][\w$]*$/;
/** A placeholder calling a function, as `{count :number}` or as a declaration writes it, `{count: number}`. */
const call = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z]\w*)(\s.*)?$/;
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
			`the placeholder {${body}} calls a function on something other than an input, which grai does not support. Write it as {name :function}.`,
		);
	}
	throw new MessageProblem(
		"message-invalid",
		`{${body}} is not a placeholder: a placeholder is a name such as {count}. Write a literal brace as \\{.`,
	);
}

/** The text a pattern shows with its markup drawn as nothing and no placeholders in it. */
export function plainText(pattern: readonly Part[]): string {
	let text = "";
	for (const part of pattern) if (part.type === "text") text += part.value;
	return text;
}
