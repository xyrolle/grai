import type { Format } from "./format-options.ts";
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
	const type = hasMarkup
		? `MarkupMessage<${inputs === "" ? "Record<string, never>" : inputs}, ${tagsType(messages)}>`
		: `Message${inputs === "" ? "" : `<${inputs}>`}`;
	return `${docComment(baseSource)}export declare const ${key}: ${type};\n`;
}

/** The names of a message's markup in every locale, as a union of string literals. */
function tagsType(messages: readonly LocaleMessage[]): string {
	const names = new Set<string>();
	for (const { variants } of messages) {
		for (const { pattern } of variants) {
			for (const part of pattern) {
				if (part.type !== "text" && part.type !== "variable")
					names.add(part.name);
			}
		}
	}
	return [...names]
		.sort()
		.map((name) => JSON.stringify(name))
		.join(" | ");
}

/**
 * The inputs every locale accepts: a count or a value formatted as a number is a number, a value
 * formatted as a date is a Date or its time value, a closed select takes the values it lists, an
 * input that gives a formatter's option, such as its currency, is a string, and anything else
 * becomes text.
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
	const formatters = new Set(
		messages.flatMap((message) => formattersOf(name, message)),
	);
	if (
		formatters.has("number") ||
		messages.some((message) =>
			[...message.plurals.values()].some((local) => local.input === name),
		)
	) {
		return "number";
	}
	if (formatters.has("relativetime")) return "number";
	if (formatters.has("datetime")) return "Date | number";
	if (formatters.has("list")) return "readonly string[]";
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
	if (accepted === undefined) {
		return messages.some((message) => givesOption(name, message))
			? "string"
			: "NonNullable<unknown>";
	}
	if (accepted.size === 0) return "never";
	return [...accepted].sort(byValue).flatMap(literalTypes).join(" | ");
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

/** The formatters a message shows an input through. */
function formattersOf(
	name: string,
	message: LocaleMessage,
): Format["formatter"][] {
	return formatsOf(message)
		.filter(({ input }) => input === name)
		.map(({ format }) => format.formatter);
}

/** Whether an input gives one of a message's formatters an option, such as its currency. */
function givesOption(name: string, message: LocaleMessage): boolean {
	return formatsOf(message).some(({ format }) => format.input?.name === name);
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
