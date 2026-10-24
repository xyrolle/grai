import { categoriesOf } from "../plurals.ts";
import { MessageProblem } from "../problem.ts";
import {
	type Converted,
	type ImportedMessage,
	plainMessage,
	pluralLocal,
	pluralOptionKeys,
	type SourceEntry,
} from "./converted.ts";
import { type Pattern, patternOf, type Texts } from "./i18next-pattern.ts";

const pluralSuffix = /^(.+)_(zero|one|two|few|many|other)$/;
const ordinalSuffix = /^(.+)_ordinal_(zero|one|two|few|many|other)$/;
const contextSuffix = /^(.+)_([a-z]+)$/;

/** A message of the source: a text, or the forms of a plural or an ordinal key, by suffix. */
type Message =
	| { kind: "text"; path: readonly string[]; value: unknown }
	| {
			kind: "plural" | "ordinal";
			path: readonly string[];
			forms: Map<string, unknown>;
	  };

/**
 * Converts one locale's i18next messages (the JSON v4 format) to grai's format. A key's plural
 * forms (`_one`, `_other`, …) become one message that chooses on `count`. Ordinal plurals are
 * left out with the reason, and so is what `patternOf` cannot convert.
 */
export function convertI18next(
	entries: readonly SourceEntry[],
	locale: string,
): ImportedMessage[] {
	const texts = new Map(
		entries.map((entry) => [entry.path.join("."), entry.value]),
	);
	return messagesOf(entries).map((message) => {
		if (message.kind === "text") {
			return convertText(message.path, message.value, texts);
		}
		if (message.kind === "plural") {
			return convertPlural(message.path, message.forms, locale, texts);
		}
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

/** The entries as messages, in source order: a key's plural forms together, at its first form's place. */
function messagesOf(entries: readonly SourceEntry[]): Message[] {
	const messages = new Map<string, Message>();
	for (const { path, value } of entries) {
		const name = path.at(-1) ?? "";
		const ordinal = ordinalSuffix.exec(name);
		const plural = ordinal ?? pluralSuffix.exec(name);
		if (plural === null) {
			messages.set(JSON.stringify(["text", ...path]), {
				kind: "text",
				path,
				value,
			});
			continue;
		}
		const [, key = "", form = ""] = plural;
		const kind = ordinal === null ? "plural" : "ordinal";
		const base = [
			...path.slice(0, -1),
			ordinal === null ? key : `${key}_ordinal`,
		];
		const id = JSON.stringify([kind, ...base]);
		const known = messages.get(id);
		if (known !== undefined && known.kind !== "text") {
			known.forms.set(form, value);
		} else {
			messages.set(id, { kind, path: base, forms: new Map([[form, value]]) });
		}
	}
	return [...messages.values()];
}

function convertText(
	path: readonly string[],
	value: unknown,
	texts: Texts,
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

/** A key's plural forms as one message choosing on the plural category of `count`. */
function convertPlural(
	path: readonly string[],
	forms: ReadonlyMap<string, unknown>,
	locale: string,
	texts: Texts,
): ImportedMessage {
	try {
		if (!forms.has("other")) {
			throw new MessageProblem(
				"message-invalid",
				"it has no _other form, which i18next needs for every count its other forms do not cover.",
			);
		}
		const categories = categoriesOf(locale, "cardinal");
		const patterns = new Map<string, Pattern>();
		for (const [form, value] of forms) {
			// i18next takes _zero for a count of 0 in every locale: an exact 0 where it is no category.
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
		return {
			path,
			result: countChoice(patterns),
			notes: missingForms(forms, categories),
		};
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { path, result: error, notes: [] };
	}
}

/** The patterns, by plural option, as one message choosing on `count`, an exact 0 before its category. */
function countChoice(patterns: ReadonlyMap<string, Pattern>): Converted {
	const inputs = [...patterns.values()].flatMap(({ inputs }) => [...inputs]);
	const local = pluralLocal("count", "cardinal", new Set(inputs));
	return {
		declarations: [local.declaration],
		selectors: patterns.has("=0") ? ["count", local.name] : [local.name],
		branches: [...patterns].map(([option, { pattern }]) => ({
			keys: new Map(pluralOptionKeys("count", local.name, option)),
			pattern,
		})),
	};
}

/** A note for the locale's categories the key has no form for. */
function missingForms(
	forms: ReadonlyMap<string, unknown>,
	categories: readonly string[],
): string[] {
	const missing = categories.filter(
		(category) => category !== "other" && !forms.has(category),
	);
	if (missing.length === 0) return [];
	return [
		`it has no _${missing.join(", _")} form: those counts show the _other text, where i18next shows the key's name.`,
	];
}
