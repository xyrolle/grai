import type { Config } from "./config.ts";
import { cookieAttributes } from "./cookie.ts";
import { globPattern } from "./globs.ts";

/** config.js: the project's config, as the runtime reads it, and whether its build has copies. */
export function configModule(config: Config, localeCopies: boolean): string {
	return [
		`export const locales = ${JSON.stringify(config.locales)};`,
		`export const baseLocale = ${JSON.stringify(config.baseLocale)};`,
		`/** @type {readonly ("ltr" | "rtl")[]} */`,
		`export const directions = ${JSON.stringify(config.locales.map(directionOf))};`,
		`/** @type {readonly ("cookie" | "localStorage" | "preferredLanguage" | "url")[]} */`,
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		"/** @type {string | undefined} */",
		`export const cookieName = ${config.cookie === undefined ? "undefined" : JSON.stringify(config.cookie.name)};`,
		`export const cookieAttributes = ${JSON.stringify(config.cookie === undefined ? "" : cookieAttributes(config.cookie))};`,
		'/** @type {"always" | "https"} */',
		`export const cookieSecure = ${JSON.stringify(config.cookie?.secure ?? "https")};`,
		"/** @type {string | undefined} */",
		`export const localStorageKey = ${config.localStorageKey === undefined ? "undefined" : JSON.stringify(config.localStorageKey)};`,
		...routingConstants(config),
		"/** @type {readonly string[]} */",
		`export const prefixes = ${JSON.stringify(config.urlRouting.prefixes)};`,
		"/** @type {readonly RegExp[]} */",
		`export const unlocalizedPaths = [${config.urlRouting.unlocalizedPaths.map((glob) => String(globPattern(glob))).join(", ")}];`,
		"/** @type {boolean} */",
		`export const localeCopies = ${localeCopies};`,
		"",
	].join("\n");
}

/** Scripts written right to left. */
const rightToLeft = new Set([
	"Adlm",
	"Arab",
	"Hebr",
	"Mand",
	"Nkoo",
	"Rohg",
	"Samr",
	"Syrc",
	"Thaa",
	"Yezi",
]);

/** The direction a locale's script is written in, from its likely script. */
function directionOf(locale: string): "ltr" | "rtl" {
	const script = new Intl.Locale(locale).maximize().script;
	return script !== undefined && rightToLeft.has(script) ? "rtl" : "ltr";
}

/**
 * Which of the url strategy's options the config uses, each a constant that a bundler folds, so a
 * page carries the code of only the options its config uses.
 */
function routingConstants(config: Config): string[] {
	const { localePrefix, prefixes, unlocalizedPaths } = config.urlRouting;
	const constants = {
		readsUrl: config.strategy.includes("url"),
		prefixesEveryLocale: localePrefix === "always",
		customPrefixes: prefixes.some(
			(prefix, index) => prefix !== config.locales[index],
		),
		leavesPathsAlone: unlocalizedPaths.length > 0,
	};
	return Object.entries(constants).map(
		([name, value]) => `export const ${name} = ${value};`,
	);
}
