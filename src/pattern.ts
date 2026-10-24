import { MessageProblem } from "./problem.ts";

/** A piece of a message's text: words, a placeholder, or markup the app draws. */
export type Part =
	| { type: "text"; value: string }
	| { type: "variable"; name: string }
	| { type: "markup-start" | "markup-end" | "markup-standalone"; name: string };

const identifier = /^[A-Za-z_$][\w$]*$/;
const markupStart = /^#([^\s/=@]+)$/;
const markupStandalone = /^#([^\s/=@]+)\s*\/$/;
const markupEnd = /^\/([^\s/=@]+)$/;
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
		const close = char === "{" ? source.indexOf("}", index + 1) : -1;
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

function placeholder(body: string): Part {
	if (identifier.test(body)) return { type: "variable", name: body };
	const start = markupStart.exec(body)?.[1];
	if (start !== undefined) return { type: "markup-start", name: start };
	const standalone = markupStandalone.exec(body)?.[1];
	if (standalone !== undefined)
		return { type: "markup-standalone", name: standalone };
	const end = markupEnd.exec(body)?.[1];
	if (end !== undefined) return { type: "markup-end", name: end };
	if (body.startsWith("#") || body.startsWith("/")) {
		throw new MessageProblem(
			"unsupported",
			`the markup {${body}} has options or attributes, which grai does not support yet. Write it as {#name}, {/name} or {#name/}.`,
		);
	}
	if (body.includes(":")) {
		throw new MessageProblem(
			"unsupported",
			`the placeholder {${body}} calls a function, which grai does not support yet. Write the value as {name} and format it before the call.`,
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
