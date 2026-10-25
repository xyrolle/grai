import type { Config, LocaleSwitch } from "./config.ts";

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
/** The locale messages render in: the request's on the server, the page's in a browser. */
export declare function getLocale(): Locale;
${setLocaleDeclaration(config.switch)}
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
	readonly code:
		| "locale-unknown"
		| "locale-not-loaded"
		| "value-unmatched"
		| "format-option-invalid";
}
type MessageOptions = { locale?: Locale };
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
// A declaration file without an export list exports every name it declares, Call included.
export {};
`;
}

/**
 * setLocale's declaration, by how the project's pages change locale: under "reload" a page keeps
 * its words until it loads again, and under "live" it switches in place, once the locale's
 * message chunks are in.
 */
function setLocaleDeclaration(localeSwitch: LocaleSwitch): string {
	return localeSwitch === "live"
		? `/**
 * Sets the locale: for the rest of the request on the server, for the process in a script. In a
 * browser it keeps the locale in the cookie or the URL and reloads, or with \`{ reload: false }\`
 * switches the page in place, resolving once the locale's message chunks are in.
 */
export declare function setLocale(locale: Locale, options?: { reload?: boolean }): Promise<void>;`
		: `/**
 * Sets the locale: for the rest of the request on the server, for the process in a script. In a
 * browser it keeps the locale in the cookie or the URL and reloads, or with \`{ reload: false }\`
 * only keeps it, for the page's next load: the page keeps its words.
 */
export declare function setLocale(locale: Locale, options?: { reload?: boolean }): void;`;
}

/** server.d.ts: the middleware, typed with the project's locales. */
export const serverDeclarations = `import type { Locale } from "./runtime.js";

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
