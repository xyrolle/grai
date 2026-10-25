/**
 * The type of each input a key's messages read: what every use of it takes, in every locale. A
 * use narrows what the input takes, and two uses no value suits both of are an error, so a call
 * that type-checks renders in every locale.
 */

import type { IntlFormatter } from "./format-functions.ts";
import type { Format } from "./format-options.ts";
import type { LocaleMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { catchAll } from "./selection.ts";

/**
 * What a use takes: any value; one a template literal turns into text, which is any but a symbol;
 * a date, which a number also gives; a number; a list of strings; a string; or one of Intl's units
 * of time, which a string also names.
 */
type Kind = "any" | "text" | "date" | "number" | "list" | "string" | "timeUnit";

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

/** A use of an input in a locale: a kind of value it takes, or the keys a select lists without `*`. */
type Use = { locale: string } & (
	| { kind: Kind; does: string }
	| { keys: ReadonlySet<string> }
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

/** The keys every select of an input lists, and the locales those selects are in. */
type Listed = { keys: ReadonlySet<string>; locales: readonly string[] };

function inputType(name: string, messages: readonly LocaleMessage[]): string {
	let kind: KindUse | undefined;
	let listed: Listed | undefined;
	for (const use of messages.flatMap((message) => usesOf(name, message))) {
		if ("keys" in use) {
			const keys =
				listed === undefined ? use.keys : common(listed.keys, use.keys);
			if (listed !== undefined && keys.size === 0) {
				throw conflict(name, together(listed), use);
			}
			const locales = new Set([...(listed?.locales ?? []), use.locale]);
			listed = { keys, locales: [...locales] };
		} else kind = narrowed(name, kind, use);
		if (
			listed !== undefined &&
			literals(kind?.kind, listed.keys).length === 0
		) {
			const first = "keys" in use ? kind : together(listed);
			if (first !== undefined) throw conflict(name, first, use);
		}
	}
	return listed === undefined
		? kindTypes[kind?.kind ?? "any"]
		: literals(kind?.kind, listed.keys).join(" | ");
}

/** The keys every select lists so far, as one use in their locales, for an error to name. */
function together({ keys, locales }: Listed): KeysUse {
	return { locale: locales.join(", "), keys };
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
		const keys = new Set(
			message.variants.map((variant) => variant.keys[index] ?? catchAll),
		);
		if (!keys.has(catchAll)) uses.push({ locale, keys });
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

/** Each value a message formats, with its input and its format: in a placeholder, or through a local. */
function formatsOf(
	message: LocaleMessage,
): { input: string; format: Format }[] {
	return [
		...message.formatted.values(),
		...message.variants.flatMap(({ pattern }) =>
			pattern.flatMap((part) =>
				part.type === "variable" && part.format
					? [{ input: part.name, format: part.format }]
					: [],
			),
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

/** A key's literal types: a number key's the number and its text, as `String(value)` matches it. */
const numberOrText = (key: string, numeric: boolean): string[] =>
	numeric ? [key, JSON.stringify(key)] : [JSON.stringify(key)];

/** The literal types of a key a value of a kind can be. */
const keyLiterals: Readonly<
	Record<Kind, (key: string, numeric: boolean) => string[]>
> = {
	any: numberOrText,
	text: numberOrText,
	date: (key, numeric) => (numeric ? [key] : []),
	number: (key, numeric) => (numeric ? [key] : []),
	list: () => [],
	string: (key) => [JSON.stringify(key)],
	timeUnit: () => [],
};

/** The literal types a value of a kind can match the keys by. */
function literals(kind: Kind | undefined, keys: ReadonlySet<string>): string[] {
	const literalsOf = keyLiterals[kind ?? "any"];
	return [...keys].sort(byValue).flatMap((key) => {
		const number = Number(key);
		return literalsOf(key, Number.isFinite(number) && String(number) === key);
	});
}

function byValue(a: string, b: string): number {
	const difference = Number(a) - Number(b);
	return Number.isNaN(difference) ? (a < b ? -1 : a > b ? 1 : 0) : difference;
}
