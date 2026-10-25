// What the compiler writes to config.js beside the runtime, for the project's config.

/** Whether the build that compiled this writes a copy of each message chunk per locale. */
export declare const localeCopies: boolean;
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
/** What `setLocale` writes after the cookie's value, but `; secure`. */
export declare const cookieAttributes: string;
/** Whether the cookie is Secure always, as its policy needs, or on https alone. */
export declare const cookieSecure: "always" | "https";
/** Whether the strategy lists `url`. */
export declare const readsUrl: boolean;
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
