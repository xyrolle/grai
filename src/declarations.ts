import { inputTypes } from "./input-types.ts";
import { type LocaleMessage, markupNames } from "./message.ts";

/**
 * A key's declaration in keys.d.ts, written as text: its type and the base locale's words. Throws
 * an InputConflict for an input no value suits every use of.
 */
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
	return markupNames(messages)
		.map((name) => JSON.stringify(name))
		.join(" | ");
}

/**
 * The inputs every locale accepts, each typed by what every use of it takes; throws an
 * InputConflict for one no value suits.
 */
function inputsType(messages: readonly LocaleMessage[]): string {
	const types = inputTypes(messages);
	if (types.size === 0) return "";
	const fields = [...types].map(([name, type]) => `${name}: ${type}`);
	return `{ ${fields.join("; ")} }`;
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
