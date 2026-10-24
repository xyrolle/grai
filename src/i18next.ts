import {
	escapeText,
	type ImportedMessage,
	plainMessage,
	pluralLocalName,
	pluralOptionKeys,
	type SourceEntry,
} from "./converted.ts";
import { categoriesOf } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

const pluralSuffix = /^(.+)_(zero|one|two|few|many|other)$/;
const contextSuffix = /^(.+)_([a-z]+)$/;
const ordinalSuffix = /^(.+)_ordinal_(zero|one|two|few|many|other)$/;
const reference = /\{\{(.*?)\}\}|\$t\(([^)]*)\)/g;
const inputName = /^[A-Za-z_$][\w$]*$/;
/** How deep `$t()` may nest before the import stops following it, as i18next does. */
const nestingLimit = 10;

/**
 * Converts one locale's i18next messages (the JSON v4 format) to grai's format. Plural keys
 * (`_one`, `_other`, …) become one message that chooses on `count`, `{{name}}` a placeholder, and
 * `$t(key)` the text of a message without inputs. Ordinal plurals, formats, nested values and
 * `$t()` with options are reported as not convertible.
 */
export function convertI18next(
	entries: readonly SourceEntry[],
	locale: string,
): ImportedMessage[] {
	const texts = new Map(
		entries.map((entry) => [entry.path.join("."), entry.value]),
	);
	/** Each message in source order: a text, or a plural's forms at the place of its first. */
	const messages = new Map<string, Text | Plural>();
	for (const { path, value } of entries) {
		const last = path.at(-1) ?? "";
		const ordinal = ordinalSuffix.exec(last);
		const match = ordinal ?? pluralSuffix.exec(last);
		if (match === null) {
			messages.set(path.join("\0"), { path, value });
			continue;
		}
		const base = [
			...path.slice(0, -1),
			`${match[1] ?? ""}${ordinal === null ? "" : "_ordinal"}`,
		];
		const id = `${ordinal === null ? "plural" : "ordinal"}\0${base.join("\0")}`;
		const plural = messages.get(id);
		const forms =
			plural !== undefined && "forms" in plural
				? plural.forms
				: new Map<string, unknown>();
		forms.set(match[2] ?? "", value);
		messages.set(id, { path: base, forms, ordinal: ordinal !== null });
	}
	return [...messages.values()].map((message) => {
		if (!("forms" in message))
			return convertText(message.path, message.value, texts);
		if (!message.ordinal)
			return convertPlural(message.path, message.forms, locale, texts);
		return {
			path: message.path,
			result: new MessageProblem(
				"unsupported",
				"its _ordinal_ forms pick an ordinal plural, which grai does not support yet.",
			),
			notes: [],
		};
	});
}

type Text = { path: readonly string[]; value: unknown };
type Plural = {
	path: readonly string[];
	forms: Map<string, unknown>;
	ordinal: boolean;
};

function convertText(
	path: readonly string[],
	value: unknown,
	texts: ReadonlyMap<string, unknown>,
): ImportedMessage {
	const notes: string[] = [];
	const context = contextSuffix.exec(path.at(-1) ?? "");
	if (
		context !== null &&
		texts.has([...path.slice(0, -1), context[1]].join("."))
	) {
		notes.push(
			`it may be i18next's context ${context[2]} of ${context[1]}, which grai imports as a key of its own. Call it where { context: "${context[2]}" } was passed.`,
		);
	}
	try {
		return {
			path,
			result: plainMessage(patternOf(value, texts).pattern),
			notes,
		};
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { path, result: error, notes };
	}
}

/** The plural forms of a key as one message choosing on the plural category of `count`. */
function convertPlural(
	path: readonly string[],
	forms: ReadonlyMap<string, unknown>,
	locale: string,
	texts: ReadonlyMap<string, unknown>,
): ImportedMessage {
	const notes: string[] = [];
	try {
		if (!forms.has("other")) {
			throw new MessageProblem(
				"message-invalid",
				`it has no _other form, which i18next needs for every count its other forms do not cover.`,
			);
		}
		const categories = categoriesOf(locale);
		const patterns = new Map<
			string,
			{ pattern: string; inputs: ReadonlySet<string> }
		>();
		for (const [form, value] of forms) {
			const option =
				form === "zero" && !categories.includes("zero") ? "=0" : form;
			// A category the locale does not have is never chosen, so it is dropped.
			if (
				option === "=0" ||
				option === "other" ||
				categories.includes(option)
			) {
				patterns.set(option, patternOf(value, texts));
			}
		}
		const missing = [...categories].filter(
			(category) => category !== "other" && !forms.has(category),
		);
		if (missing.length > 0) {
			notes.push(
				`it has no _${missing.join(", _")} form: those counts show the _other text, where i18next shows the key's name.`,
			);
		}
		const local = pluralLocalName(
			"count",
			new Set([...patterns.values()].flatMap(({ inputs }) => [...inputs])),
		);
		return {
			path,
			result: {
				declarations: [`local ${local} = count: plural`],
				selectors: patterns.has("=0") ? ["count", local] : [local],
				branches: [...patterns].map(([option, { pattern }]) => ({
					keys: new Map(pluralOptionKeys("count", local, option)),
					pattern,
				})),
			},
			notes,
		};
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { path, result: error, notes: [] };
	}
}

/** An i18next string as a grai pattern, with the inputs it reads. */
function patternOf(
	value: unknown,
	texts: ReadonlyMap<string, unknown>,
	depth = 0,
): { pattern: string; inputs: ReadonlySet<string> } {
	if (typeof value !== "string") {
		throw new MessageProblem(
			"unsupported",
			`its value is ${Array.isArray(value) ? "a list" : `a ${typeof value}`}, not a string; grai messages are text.`,
		);
	}
	const inputs = new Set<string>();
	let pattern = "";
	let last = 0;
	for (const match of value.matchAll(reference)) {
		pattern += escapeText(value.slice(last, match.index));
		last = match.index + match[0].length;
		const [, placeholder, nested] = match;
		if (placeholder !== undefined) {
			const name = placeholder.trim().replace(/^-\s*/, "");
			pattern += `{${inputOf(name, match[0])}}`;
			inputs.add(name);
		} else {
			pattern += nestedText(nested?.trim() ?? "", texts, depth);
		}
	}
	return { pattern: pattern + escapeText(value.slice(last)), inputs };
}

function inputOf(name: string, written: string): string {
	if (name.includes(",")) {
		throw new MessageProblem(
			"unsupported",
			`${written} formats the value, which grai does not support yet. Format it before the call and pass the text.`,
		);
	}
	if (!inputName.test(name)) {
		throw new MessageProblem(
			"unsupported",
			`${written} reads ${name.includes(".") ? "a value nested in an input" : "an input whose name is not a JavaScript identifier"}, which grai does not support. Pass it as one input, such as {{name}}.`,
		);
	}
	return name;
}

/** The text of a `$t(key)` message, which must have no inputs, inlined. */
function nestedText(
	key: string,
	texts: ReadonlyMap<string, unknown>,
	depth: number,
): string {
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
