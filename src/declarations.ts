import type { Config } from "./config.ts";
import type { LocaleMessage } from "./message.ts";
import { catchAll } from "./selection.ts";

/** A key's declaration in keys.d.ts, written as text: its type and the base locale's words. */
export function keyDeclaration(
	key: string,
	messages: readonly LocaleMessage[],
	baseSource: unknown,
): string {
	const hasMarkup = messages.some((message) => message.markup);
	const inputs = inputsType(messages);
	const type = `${hasMarkup ? "MarkupMessage" : "Message"}${inputs === "" ? "" : `<${inputs}>`}`;
	return `${docComment(baseSource)}export declare const ${key}: ${type};\n`;
}

/**
 * The inputs every locale accepts: a count is a number, a closed select takes the values it lists,
 * and anything else becomes text.
 */
function inputsType(messages: readonly LocaleMessage[]): string {
	const names = new Set(messages.flatMap((message) => [...message.inputs]));
	if (names.size === 0) return "";
	const fields = [...names]
		.sort()
		.map((name) => `${name}: ${inputType(name, messages)}`);
	return `{ ${fields.join("; ")} }`;
}

function inputType(name: string, messages: readonly LocaleMessage[]): string {
	if (
		messages.some((message) => [...message.plurals.values()].includes(name))
	) {
		return "number";
	}
	let accepted: Set<string> | undefined;
	for (const message of messages) {
		const index = message.selectors.findIndex(
			(selector) => selector.kind === "input" && selector.name === name,
		);
		if (index === -1) continue;
		const keys = new Set(
			message.variants.map((variant) => variant.keys[index] ?? catchAll),
		);
		if (keys.has(catchAll)) continue;
		accepted =
			accepted === undefined
				? keys
				: new Set([...accepted].filter((key) => keys.has(key)));
	}
	if (accepted === undefined) return "NonNullable<unknown>";
	if (accepted.size === 0) return "never";
	return [...accepted].sort(byValue).flatMap(literalTypes).join(" | ");
}

/** A key matches the values whose text it is: `1` and `"1"` for the key 1, `"a"` for the key a. */
function literalTypes(key: string): string[] {
	const number = Number(key);
	return Number.isFinite(number) && String(number) === key
		? [key, JSON.stringify(key)]
		: [JSON.stringify(key)];
}

function byValue(a: string, b: string): number {
	const difference = Number(a) - Number(b);
	return Number.isNaN(difference) ? (a < b ? -1 : a > b ? 1 : 0) : difference;
}

/** The base locale's words, as the catalog has them, for an editor to show at the call site. */
function docComment(source: unknown): string {
	const lines =
		typeof source === "string"
			? [source]
			: Object.entries(matchOf(source)).map(
					([key, pattern]) => `${key}: ${pattern}`,
				);
	const body = lines
		.flatMap((line) => line.split("\n"))
		.map((line) => line.replaceAll("*/", "*\\/"));
	return body.length === 1
		? `/** ${body[0]} */\n`
		: `/**\n${body.map((line) => ` * ${line}`).join("\n")}\n */\n`;
}

function matchOf(source: unknown): Record<string, unknown> {
	const match: unknown = Array.isArray(source) ? source[0]?.match : undefined;
	return typeof match === "object" && match !== null ? { ...match } : {};
}

/** runtime.d.ts: the runtime's API, typed with the project's locales. */
export function runtimeDeclarations(config: Config): string {
	const locales = config.locales.map((locale) => JSON.stringify(locale));
	return `/** One of the project's locales. */
export type Locale = ${locales.join(" | ")};
/** The project's locales, in the config's order. */
export declare const locales: readonly [${locales.join(", ")}];
/** The locale a call renders in when it names none. */
export declare const baseLocale: ${JSON.stringify(config.baseLocale)};
/** Whether a value is one of the project's locales. */
export declare function isLocale(value: unknown): value is Locale;
/** The value, if it is one of the project's locales; otherwise throws a GraiError. */
export declare function assertIsLocale(value: unknown): Locale;
/** A message called with an unknown locale, or with a value none of its variants accepts. */
export declare class GraiError extends Error {
	readonly code: string;
}
export type MessageOptions = { locale?: Locale };
/** A run of a message's text, or a piece of its markup, as \`.parts()\` gives them. */
export type MessagePart =
	| { type: "text"; value: string }
	| {
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: string;
			options: Record<string, never>;
			attributes: Record<string, never>;
	  };
type Call<Inputs, Result> = {} extends Inputs
	? (inputs?: Inputs, options?: MessageOptions) => Result
	: (inputs: Inputs, options?: MessageOptions) => Result;
/** A message: its inputs, and the locale to render it in, else the base locale. */
export type Message<Inputs extends object = Record<string, never>> = Call<Inputs, string>;
/** A message with markup, which \`.parts()\` gives as text and markup parts. */
export type MarkupMessage<Inputs extends object = Record<string, never>> = Message<Inputs> & {
	parts: Call<Inputs, MessagePart[]>;
};
`;
}
