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
/** What `setLocale` writes after the cookie's value, but `; secure`. */
export declare const cookieAttributes: string;
/** Whether the cookie is Secure always, as its policy needs, or on https alone. */
export declare const cookieSecure: "always" | "https";
