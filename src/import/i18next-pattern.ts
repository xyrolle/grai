import { MessageProblem } from "../problem.ts";
import { escapeText, textOf } from "./converted.ts";
import { formatCall } from "./i18next-formats.ts";

/** A grai pattern, with the inputs it reads. */
export type Pattern = { pattern: string; inputs: ReadonlySet<string> };

/** A file's messages by dotted key, which `$t(key)` names. */
export type Texts = ReadonlyMap<string, unknown>;

const reference = /\{\{(.*?)\}\}|\$t\(([^)]*)\)/g;
const inputName = /^[A-Za-z_$][\w$]*$/;
/** How deep `$t()` may nest before the import stops following it, as i18next does. */
const nestingLimit = 10;

/**
 * An i18next string as a grai pattern: `{{name}}` and `{{- name}}` become a placeholder,
 * `{{value, number}}` and i18next's other built-in formats one that formats alike, and `$t(key)`
 * the text of a message of the same file without inputs. Other formats, nested values and `$t()`
 * with options throw a MessageProblem.
 */
export function patternOf(value: unknown, texts: Texts, depth = 0): Pattern {
	const text = textOf(value);
	const inputs = new Set<string>();
	let pattern = "";
	let last = 0;
	for (const match of text.matchAll(reference)) {
		pattern += escapeText(text.slice(last, match.index));
		last = match.index + match[0].length;
		const [written, placeholder, nested] = match;
		if (placeholder !== undefined) {
			const comma = placeholder.indexOf(",");
			const read = comma === -1 ? placeholder : placeholder.slice(0, comma);
			const name = inputOf(read.trim().replace(/^-\s*/, ""), written);
			pattern +=
				comma === -1
					? `{${name}}`
					: `{${name} ${formatCall(placeholder.slice(comma + 1).trim(), written)}}`;
			inputs.add(name);
		} else {
			pattern += nestedText(nested?.trim() ?? "", texts, depth);
		}
	}
	return { pattern: pattern + escapeText(text.slice(last)), inputs };
}

function inputOf(name: string, written: string): string {
	if (!inputName.test(name)) {
		throw new MessageProblem(
			"unsupported",
			`${written} reads ${name.includes(".") ? "a value nested in an input" : "an input whose name is not a JavaScript identifier"}, which grai does not support. Pass it as one input, such as {{name}}.`,
		);
	}
	return name;
}

/** The text of a `$t(key)` message, which must have no inputs, inlined. */
function nestedText(key: string, texts: Texts, depth: number): string {
	if (key.includes(",")) {
		throw new MessageProblem(
			"unsupported",
			`$t(${key}) passes options to the nested message, which grai does not support. Write its text here, or call that message where this one is used.`,
		);
	}
	const target = texts.get(key);
	if (target === undefined || depth >= nestingLimit) {
		throw new MessageProblem(
			"unsupported",
			`$t(${key}) nests ${target === undefined ? "a key that is not a text in the same file" : "messages too deep, or in a cycle"}. Write its text here.`,
		);
	}
	const { pattern, inputs } = patternOf(target, texts, depth + 1);
	if (inputs.size > 0) {
		throw new MessageProblem(
			"unsupported",
			`$t(${key}) nests a message with inputs, which grai does not support. Write its text here.`,
		);
	}
	return pattern;
}
