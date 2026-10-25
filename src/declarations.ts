import type { Config } from "./config.ts";
import { inputTypes } from "./input-types.ts";
import type { LocaleMessage } from "./message.ts";
import { isMarkup } from "./pattern.ts";

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
	const names = new Set<string>();
	for (const { variants } of messages) {
		for (const { pattern } of variants) {
			for (const part of pattern) {
				if (isMarkup(part)) names.add(part.name);
			}
		}
	}
	return [...names]
		.sort()
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
export declare const cookieName: ${config.cookie === undefined ? "undefined" : JSON.stringify(config.cookie.name)};
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
/** The locale a URL's first path segment names under the \`url\` strategy, else the base locale. */
export declare function extractLocaleFromUrl(url: string | URL): Locale;
/** A URL without its locale prefix; without the \`url\` strategy, as it is. */
export declare function deLocalizeUrl(url: string | URL): URL;
/** A URL with a locale's prefix under the \`url\` strategy: the current locale's, unless \`options.locale\` names another. */
export declare function localizeUrl(url: string | URL, options?: { locale?: Locale }): URL;
/** A path such as \`/cart\` with a locale's prefix under the \`url\` strategy; any other href as it is. */
export declare function localizeHref(href: string, options?: { locale?: Locale }): string;
/** A message called in a locale it cannot render in, or with a value its variants do not take. */
export declare class GraiError extends Error {
	readonly code: string;
}
export type MessageOptions = { locale?: Locale };
/**
 * A run of a message's text, or a piece of its markup, as \`.parts()\` gives them: its name one
 * of the message's tags, each option's value, and each attribute's, true for one without a value.
 */
export type MessagePart<Tag extends string = string> =
	| { type: "text"; value: string }
	| {
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: Tag;
			options: Readonly<Record<string, unknown>>;
			attributes: Readonly<Record<string, string | true>>;
	  };
type Call<Inputs, Result> = {} extends Inputs
	? (inputs?: Inputs, options?: MessageOptions) => Result
	: (inputs: Inputs, options?: MessageOptions) => Result;
/** A message: its inputs, and the locale to render it in, else the base locale. */
export type Message<Inputs extends object = Record<string, never>> = Call<Inputs, string>;
/** A message with markup, which \`.parts()\` gives as text and markup parts, its tags named by \`Tag\`. */
export type MarkupMessage<
	Inputs extends object = Record<string, never>,
	Tag extends string = string,
> = Message<Inputs> & {
	parts: Call<Inputs, MessagePart<Tag>[]>;
};
// What the rest of the output calls; not for apps.
/** The locale a URL's path names for the \`url\` strategy, if any. Apps call extractLocaleFromUrl. */
export declare function localeOfPath(pathname: string): Locale | undefined;
/** Lets server.js bind each request's locale. Apps bind it through the middleware. */
export declare function bindRequests(storage: {
	getStore(): RequestLocale | undefined;
}): void;
/** A request's locale, by its position in \`locales\`. */
export type RequestLocale = { index: number };
/** A message's inputs as its compiled code reads them; the key's declaration types them. */
type CompiledInputs = { readonly [input: string]: unknown };
/** A compiled message without inputs: its text in each locale, in \`locales\` order. */
export declare function text(...texts: string[]): Message;
/** A compiled message without inputs as the page's string, chosen once. */
export declare function pageText(...texts: string[]): string;
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
/** The unit of time an input gives a relative time; throws for a value that is not one. */
export declare function timeUnit(unit: unknown): Intl.RelativeTimeFormatUnit;
/** The formatter for a call with the value an input gives one of its options, kept by the value. */
export declare function formatterFor<Made extends Intl.NumberFormat | Intl.DateTimeFormat>(
	made: Map<unknown, Made>,
	IntlFormat: new (locale: string, options: object) => Made,
	locale: string,
	written: object,
	option: string,
	value: unknown,
): Made;
`;
}

/** server.d.ts: the middleware, typed with the project's locales. */
export const serverDeclarations = `import type { Locale } from "./runtime.js";

/** Whether the build that compiled the output writes a copy of each message chunk per locale. */
export declare const localeCopies: boolean;

/**
 * Resolves a request's locale by the config's strategy and binds it for the handler and all it
 * calls. Returns the handler's response, its \`Vary\` listing the request headers the strategy
 * reads.
 */
export declare function middleware(
	request: Request,
	handler: (resolved: {
		request: Request;
		locale: Locale;
	}) => Response | Promise<Response>,
): Promise<Response>;
`;
