// What the compiler writes to config.js beside the runtime, for the project's config.

/** The project's locales, in the config's order. */
export declare const locales: readonly string[];
/** The locale a call renders in when it names none. */
export declare const baseLocale: string;
/** Where the server's middleware looks for a request's locale, in order, before the base locale. */
export declare const strategy: readonly (
	| "cookie"
	| "preferredLanguage"
	| "url"
)[];
/** The direction each locale's script is written in, in `locales` order. */
export declare const directions: readonly ("ltr" | "rtl")[];
/** The cookie the `cookie` strategy reads and `setLocale` writes, if the strategy has it. */
export declare const cookieName: string | undefined;
/** Whether the strategy lists `url`. */
export declare const readsUrl: boolean;
/** Whether every locale's paths have a prefix, the base locale's too: `localePrefix: "always"`. */
export declare const prefixesEveryLocale: boolean;
/** Whether a locale has a prefix other than its tag: `localePrefixes`. */
export declare const customPrefixes: boolean;
/** Whether the config names paths the `url` strategy leaves alone: `unlocalizedPaths`. */
export declare const leavesPathsAlone: boolean;
/** Whether the config translates paths into each locale's words: `pathnames`. */
export declare const translatesPaths: boolean;
/** Each locale's prefix in the `url` strategy's paths, in `locales` order. */
export declare const prefixes: readonly string[];
/** A path in a locale's words, by its position in `locales`, as the app's route: `/ueber-uns` as `/about`. */
export declare function routePath(pathname: string, locale: number): string;
/** A route in a locale's words, by its position in `locales`: `/about` as `/ueber-uns`. */
export declare function localePath(pathname: string, locale: number): string;
/** The paths the `url` strategy leaves alone, as regular expressions of a URL's path. */
export declare const unlocalizedPaths: readonly RegExp[];
