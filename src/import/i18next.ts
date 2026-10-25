import { categoriesOf, type PluralType } from "../plurals.ts";
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
	| PluralMessage;

/** A key's plural or ordinal forms, by form. */
type PluralMessage = {
	kind: PluralType;
	path: readonly string[];
	forms: Map<string, unknown>;
};

/**
 * Converts one locale's i18next messages (the JSON v4 format) to grai's format. A key's plural
 * forms (`_one`, `_other`, …) become one message that chooses on `count`, and so do its ordinal
 * forms (`_ordinal_one`, …), as a key of its own. What `patternOf` cannot convert is left out
 * with the reason.
 */
export function convertI18next(
	entries: readonly SourceEntry[],
	locale: string,
): ImportedMessage[] {
	const texts = new Map(
		entries.map((entry) => [entry.path.join("."), entry.value]),
	);
	return messagesOf(entries).map((message) =>
		message.kind === "text"
			? convertText(message.path, message.value, texts)
			: convertPlural(message, locale, texts),
	);
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
		const kind = ordinal === null ? "cardinal" : "ordinal";
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
		const { pattern, escaped } = patternOf(value, texts);
		if (escaped.size > 0) notes.push(escapedValues);
		return { path, result: plainMessage(pattern), notes };
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { path, result: error, notes };
	}
}

/** A key's plural or ordinal forms as one message choosing on the category of `count`. */
function convertPlural(
	{ kind, path, forms }: PluralMessage,
	locale: string,
	texts: Texts,
): ImportedMessage {
	const suffix = kind === "cardinal" ? "_" : "_ordinal_";
	try {
		if (!forms.has("other")) {
			throw new MessageProblem(
				"message-invalid",
				`it has no ${suffix}other form, which i18next needs for every count its other forms do not cover.`,
			);
		}
		const categories = categoriesOf(locale, kind);
		const patterns = new Map<string, Pattern>();
		for (const [form, value] of forms) {
			// i18next takes a plural's _zero for a count of 0 in every locale: an exact 0 where it is
			// no category. An ordinal's _ordinal_zero is only ever its category.
			const option =
				kind === "cardinal" && form === "zero" && !categories.includes("zero")
					? "=0"
					: form;
			// A category the locale does not have is never chosen, so it is dropped.
			if (
				option === "=0" ||
				option === "other" ||
				categories.includes(option)
			) {
				patterns.set(option, patternOf(value, texts));
			}
		}
		const missing = missingForms(forms, categories, suffix);
		// The count is a number, which escaping leaves as it is.
		const escapes = [...patterns.values()].some(({ escaped }) =>
			[...escaped].some((name) => name !== "count"),
		);
		const notes = [
			...(kind === "cardinal" ? [] : [ordinalKey]),
			...missing,
			...(escapes ? [escapedValues] : []),
		];
		return { path, result: countChoice(patterns, kind), notes };
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return { path, result: error, notes: [] };
	}
}

/**
 * What a message whose values i18next escapes renders differently: grai leaves escaping to whatever
 * shows the text, as a framework does, since escaping in the message would show `&amp;` in every
 * text a framework or a native view escapes again.
 */
const escapedValues =
	"i18next escapes the values of {{name}} for HTML by default, and grai gives them as they are, for the page to escape as React, Vue and Svelte do when they show text. Where this text is set as HTML, escape the values first.";

/** How an ordinal is called once imported: by a key of its own, as i18next calls it by the plural's. */
const ordinalKey =
	"its _ordinal_ forms become a key of their own, ending in _ordinal. Call it where { ordinal: true } was passed.";

/** The patterns, by plural option, as one message choosing on `count`, an exact 0 before its category. */
function countChoice(
	patterns: ReadonlyMap<string, Pattern>,
	type: PluralType,
): Converted {
	const inputs = [...patterns.values()].flatMap(({ inputs }) => [...inputs]);
	const local = pluralLocal("count", type, new Set(inputs));
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
	suffix: string,
): string[] {
	const missing = categories.filter(
		(category) => category !== "other" && !forms.has(category),
	);
	if (missing.length === 0) return [];
	return [
		`it has no ${suffix}${missing.join(`, ${suffix}`)} form: those counts show the ${suffix}other text, where i18next shows the key's name.`,
	];
}
