import type { Config } from "./config.ts";
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
	const type = `${hasMarkup ? "MarkupMessage" : "Message"}${inputs === "" ? "" : `<${inputs}>`}`;
	return `${docComment(baseSource)}export declare const ${key}: ${type};\n`;
}

/**
 * The inputs every locale accepts: a count or a value formatted as a number is a number, a value
 * formatted as a date is a Date or its time value, a closed select takes the values it lists, and
 * anything else becomes text.
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
		messages.some((message) => [...message.plurals.values()].includes(name))
	) {
		return "number";
	}
	if (formatters.has("datetime")) return "Date | number";
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

/** The formatters a message shows an input through: in a placeholder, or through a local. */
function formattersOf(
	name: string,
	message: LocaleMessage,
): Format["formatter"][] {
	const formatters: Format["formatter"][] = [];
	for (const local of message.formatted.values()) {
		if (local.input === name) formatters.push(local.format.formatter);
	}
	for (const { pattern } of message.variants) {
		for (const part of pattern) {
			if (part.type === "variable" && part.name === name && part.format) {
				formatters.push(part.format.formatter);
			}
		}
	}
	return formatters;
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
/** The cookie the server's "cookie" strategy reads, and \`setLocale\` writes. */
export declare const cookieName: ${config.cookieName === undefined ? "undefined" : JSON.stringify(config.cookieName)};
/** The locale messages render in: the request's on the server, the page's in a browser. */
export declare function getLocale(): Locale;
/**
 * Sets the locale: for the rest of the request on the server, for the process in a script. In a
 * browser it sets \`<html lang>\` and \`dir\`, keeps the locale in the cookie or the URL and
 * reloads, unless \`{ reload: false }\`.
 */
export declare function setLocale(locale: Locale, options?: { reload?: boolean }): void;
/** The direction a locale's script is written in, the bound locale's by default. */
export declare function getTextDirection(locale?: Locale): "ltr" | "rtl";
/** The locale a URL's first path segment names, else the base locale. */
export declare function extractLocaleFromUrl(url: string | URL): Locale;
/** A URL without its locale prefix. */
export declare function deLocalizeUrl(url: string | URL): URL;
/** A URL with a locale's prefix: the current locale's, unless \`options.locale\` names another. */
export declare function localizeUrl(url: string | URL, options?: { locale?: Locale }): URL;
/** A path such as \`/cart\` with a locale's prefix; any other href as it is. */
export declare function localizeHref(href: string, options?: { locale?: Locale }): string;
/** A message called in a locale it cannot render in, or with a value its variants do not take. */
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
// What the rest of the output calls; not for apps.
/** Lets server.js bind each request's locale. Apps bind it through the middleware. */
export declare function bindRequests(storage: {
	getStore(): number | undefined;
	enterWith(index: number): void;
}): void;
/** A message's inputs as its compiled code reads them; the key's declaration types them. */
type CompiledInputs = { readonly [input: string]: unknown };
/** A compiled message without inputs: its text in each locale, in \`locales\` order. */
export declare function text(...texts: string[]): Message;
/** A compiled message with inputs: a function per locale, in \`locales\` order. */
export declare function message(
	...variants: ((inputs: CompiledInputs) => string)[]
): Message<CompiledInputs>;
/** A compiled message with markup: its text and its parts, a function per locale for each. */
export declare function markup(
	strings: ((inputs: CompiledInputs) => string)[],
	parts: ((inputs: CompiledInputs) => MessagePart[])[],
): MarkupMessage<CompiledInputs>;
/** Throws for a value a closed select does not list. */
export declare function unmatched(
	key: string,
	locale: string,
	selector: string,
	value: unknown,
): never;
`;
}

/** server.d.ts: the middleware, typed with the project's locales. */
export const serverDeclarations = `import type { Locale } from "./runtime.js";

/**
 * Resolves a request's locale by the config's strategy and binds it for the handler and all it
 * calls. Returns what the handler returns.
 */
export declare function middleware<Result>(
	request: Request,
	handler: (resolved: { request: Request; locale: Locale }) => Result,
): Result;
`;
