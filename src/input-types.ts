/**
 * The type of each input a key's messages read: what every use of it takes, in every locale. A
 * use narrows what the input takes, and two uses no value suits both of are an error, so a call
 * that type-checks renders in every locale.
 */

import type { IntlFormatter } from "./format-functions.ts";
import type { Format } from "./format-options.ts";
import { literals } from "./key-literals.ts";
import type { LocaleMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { catchAll } from "./selection.ts";

/**
 * What a use takes: any value; one a template literal turns into text, which is any but a symbol;
 * a date, which a number also gives; a number; a list of strings; a string; or one of Intl's units
 * of time, which a string also names.
 */
export type Kind =
	| "any"
	| "text"
	| "date"
	| "number"
	| "list"
	| "string"
	| "timeUnit";

const kindTypes: Readonly<Record<Kind, string>> = {
	any: "NonNullable<unknown>",
	text: "string | number | bigint | boolean | object",
	date: "Date | number",
	number: "number",
	list: "readonly string[]",
	string: "string",
	timeUnit: "Intl.RelativeTimeFormatUnit",
};

/** The kinds whose values a kind takes, itself among them. */
const narrower: Readonly<Record<Kind, readonly Kind[]>> = {
	any: ["any", "text", "date", "number", "list", "string", "timeUnit"],
	text: ["text", "date", "number", "list", "string", "timeUnit"],
	date: ["date", "number"],
	number: ["number"],
	list: ["list"],
	string: ["string", "timeUnit"],
	timeUnit: ["timeUnit"],
};

/** The kind each formatter takes, and how an error names its use. */
const formatterUses: Readonly<Record<IntlFormatter, [Kind, string]>> = {
	number: ["number", "is formatted as a number"],
	relativetime: ["number", "is formatted as a relative time"],
	datetime: ["date", "is formatted as a date"],
	list: ["list", "is formatted as a list"],
};

/**
 * A use of an input in a locale: a kind of value it takes, or the keys a select lists without `*`,
 * and whether it matches them in NFC, as a `:string` select does, or exactly.
 */
type Use = { locale: string } & (
	| { kind: Kind; does: string }
	| { keys: ReadonlySet<string>; normalized: boolean }
);
type KindUse = Extract<Use, { kind: Kind }>;
type KeysUse = Extract<Use, { keys: ReadonlySet<string> }>;

/** Two uses of an input no value suits both of, in the locale of the second. */
export class InputConflict extends MessageProblem {
	readonly locale: string;

	constructor(locale: string, detail: string) {
		super("message-invalid", detail);
		this.locale = locale;
	}
}

/** Each input's type, by name; throws an InputConflict for an input no value suits every use of. */
export function inputTypes(
	messages: readonly LocaleMessage[],
): Map<string, string> {
	const names = new Set(messages.flatMap((message) => [...message.inputs]));
	return new Map(
		[...names].sort().map((name) => [name, inputType(name, messages)]),
	);
}

/**
 * The keys every select of an input lists: those every select that matches exactly lists, and
 * those every `:string` select lists, in NFC; and the locales those selects are in.
 */
type Listed = {
	exact: ReadonlySet<string> | undefined;
	normalized: ReadonlySet<string> | undefined;
	locales: readonly string[];
};

function inputType(name: string, messages: readonly LocaleMessage[]): string {
	let kind: KindUse | undefined;
	let listed: Listed | undefined;
	for (const use of messages.flatMap((message) => usesOf(name, message))) {
		if ("keys" in use) {
			const next = withUse(listed, use);
			if (listed !== undefined && keysOf(next).size === 0) {
				throw conflict(name, together(listed), use);
			}
			listed = next;
		} else kind = narrowed(name, kind, use);
		if (
			listed !== undefined &&
			literals(kind?.kind, keysOf(listed)).length === 0
		) {
			const first = "keys" in use ? kind : together(listed);
			if (first !== undefined) throw conflict(name, first, use);
		}
	}
	return listed === undefined
		? kindTypes[kind?.kind ?? "any"]
		: literals(kind?.kind, keysOf(listed)).join(" | ");
}

/** The keys listed once a select lists its own too. */
function withUse(listed: Listed | undefined, use: KeysUse): Listed {
	const within = (keys: ReadonlySet<string> | undefined) =>
		keys === undefined ? use.keys : common(keys, use.keys);
	const locales = [...new Set([...(listed?.locales ?? []), use.locale])];
	return use.normalized
		? { exact: listed?.exact, normalized: within(listed?.normalized), locales }
		: { exact: within(listed?.exact), normalized: listed?.normalized, locales };
}

/**
 * The values every select matches a key of: the exact keys whose NFC form every `:string` select
 * lists, or, with no select that matches exactly, the keys in NFC.
 */
function keysOf({ exact, normalized }: Listed): ReadonlySet<string> {
	if (exact === undefined) return normalized ?? new Set();
	if (normalized === undefined) return exact;
	return new Set(
		[...exact].filter((key) => normalized.has(key.normalize("NFC"))),
	);
}

/** The keys every select lists so far, as one use in their locales, for an error to name. */
function together(listed: Listed): KeysUse {
	const locale = listed.locales.join(", ");
	return {
		locale,
		keys: keysOf(listed),
		normalized: listed.exact === undefined,
	};
}

/** What an input takes once a use narrows it: the narrower of the two kinds. */
function narrowed(
	name: string,
	kind: KindUse | undefined,
	use: KindUse,
): KindUse {
	if (kind === undefined || narrower[kind.kind].includes(use.kind)) return use;
	if (narrower[use.kind].includes(kind.kind)) return kind;
	throw conflict(name, kind, use);
}

/** Each use a message makes of an input, in the order an error is likeliest to make sense in. */
function usesOf(name: string, message: LocaleMessage): Use[] {
	const { locale } = message;
	const uses: Use[] = [];
	const take = (kind: Kind, does: string) => uses.push({ locale, kind, does });
	for (const local of message.plurals.values()) {
		if (local.input === name) take("number", "is counted by a plural");
	}
	for (const [index, selector] of message.selectors.entries()) {
		if (selector.kind !== "input" || selector.input !== name) continue;
		// A :string selector matches in NFC, so its keys are taken in it, as two locales may write
		// one key differently.
		const keys = new Set(
			message.variants.map((variant) => {
				const key = variant.keys[index] ?? catchAll;
				return selector.normalized ? key.normalize("NFC") : key;
			}),
		);
		if (!keys.has(catchAll)) {
			uses.push({ locale, keys, normalized: selector.normalized });
		}
	}
	for (const { input, format } of formatsOf(message)) {
		if (input === name) take(...formatterUses[format.formatter]);
		if (format.input?.name === name) {
			take(format.input.type, `gives a value its ${format.input.option}`);
		}
	}
	for (const { pattern } of message.variants) {
		for (const part of pattern) {
			if (part.type === "variable" && !part.format && part.name === name) {
				take("text", "is shown as text");
			}
		}
	}
	return uses;
}

type Formatted = { input: string | undefined; format: Format };

/**
 * Each value a message formats, with its input and its format: in a placeholder, through a local,
 * or a literal's, which has no input but may take an option from one.
 */
function formatsOf(message: LocaleMessage): Formatted[] {
	return [
		...message.formatted.values(),
		...message.variants.flatMap(({ pattern }) =>
			pattern.flatMap((part): Formatted[] => {
				if (part.type === "variable" && part.format) {
					return [{ input: part.name, format: part.format }];
				}
				return part.type === "literal" && part.format
					? [{ input: undefined, format: part.format }]
					: [];
			}),
		),
	];
}

function conflict(name: string, first: Use, second: Use): InputConflict {
	return new InputConflict(
		second.locale,
		`${name} ${doing(first)} in ${first.locale} and ${doing(second)} in ${second.locale}, and no value suits both. Give each use its own input.`,
	);
}

function doing(use: Use): string {
	return "keys" in use
		? `is selected without * on ${[...use.keys].join(", ")}`
		: use.does;
}

function common(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set([...a].filter((key) => b.has(key)));
}
