// What the compiler writes to config.js beside the runtime, for the project's config.

/** Whether the build that compiled this writes a copy of each message chunk per locale. */
export declare const localeCopies: boolean;
/** The project's locales, in the config's order. */
export declare const locales: readonly string[];
/** The locale a call renders in when it names none. */
export declare const baseLocale: string;
/** Where the server's middleware and a page look for the locale, in order, before the base locale. */
export declare const strategy: readonly (
	| "cookie"
	| "localStorage"
	| "preferredLanguage"
	| "query"
	| "url"
)[];
/** The direction each locale's script is written in, in `locales` order. */
export declare const directions: readonly ("ltr" | "rtl")[];
/** The cookie the `cookie` strategy reads and `setLocale` writes, if the strategy has it. */
export declare const cookieName: string | undefined;
/** What `setLocale` writes after the cookie's value, but `; secure`. */
export declare const cookieAttributes: string;
/** Whether the cookie is Secure always, as its policy needs, or on https alone. */
export declare const cookieSecure: "always" | "https";
/** The key in `localStorage` the `localStorage` strategy reads and `setLocale` writes, if it has it. */
export declare const localStorageKey: string | undefined;
/** The URL's query parameter the `query` strategy reads and `setLocale` names the locale in, if it has it. */
export declare const queryParameter: string | undefined;
/** Whether the strategy lists `url`. */
export declare const readsUrl: boolean;
/** Whether the strategy lists a place that keeps a visitor's choice: any but `preferredLanguage`. */
export declare const keepsChoice: boolean;
/** Whether every locale's paths have a prefix, the base locale's too: `localePrefix: "always"`. */
export declare const prefixesEveryLocale: boolean;
/** Whether a locale has a prefix other than its tag: `localePrefixes`. */
export declare const customPrefixes: boolean;
/** Whether the config names paths the `url` strategy leaves alone: `unlocalizedPaths`. */
export declare const leavesPathsAlone: boolean;
/** Each locale's prefix in the `url` strategy's paths, in `locales` order. */
export declare const prefixes: readonly string[];
/** The paths the `url` strategy leaves alone, as regular expressions of a URL's path. */
export declare const unlocalizedPaths: readonly RegExp[];
/** Whether the config gives routes their paths in a locale's words: `pathnames`. */
export declare const translatesPaths: boolean;
/**
 * Each route's path, and its path in each locale's words, in `locales` order: the pattern a path
 * matches, its named segments, and the path to fill.
 */
export declare const pathnames: readonly {
	route: { pattern: RegExp; names: readonly string[]; path: string };
	locales: readonly {
		pattern: RegExp;
		names: readonly string[];
		path: string;
	}[];
}[];
