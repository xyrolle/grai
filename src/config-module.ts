import type { Config } from "./config.ts";
import { cookieAttributes } from "./cookie.ts";
import { globPattern } from "./globs.ts";
import { pathnamesTable } from "./pathnames.ts";

/** config.js: the project's config, as the runtime reads it, and whether its build has copies. */
export function configModule(config: Config, localeCopies: boolean): string {
	return [
		`export const locales = ${JSON.stringify(config.locales)};`,
		`export const baseLocale = ${JSON.stringify(config.baseLocale)};`,
		`/** @type {readonly ("ltr" | "rtl")[]} */`,
		`export const directions = ${JSON.stringify(config.locales.map(directionOf))};`,
		`/** @type {readonly ("cookie" | "localStorage" | "preferredLanguage" | "query" | "url")[]} */`,
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		"/** @type {string | undefined} */",
		`export const cookieName = ${config.cookie === undefined ? "undefined" : JSON.stringify(config.cookie.name)};`,
		`export const cookieAttributes = ${JSON.stringify(config.cookie === undefined ? "" : cookieAttributes(config.cookie))};`,
		'/** @type {"always" | "https"} */',
		`export const cookieSecure = ${JSON.stringify(config.cookie?.secure ?? "https")};`,
		"/** @type {string | undefined} */",
		`export const localStorageKey = ${config.localStorageKey === undefined ? "undefined" : JSON.stringify(config.localStorageKey)};`,
		"/** @type {string | undefined} */",
		`export const queryParameter = ${config.queryParameter === undefined ? "undefined" : JSON.stringify(config.queryParameter)};`,
		...strategyConstants(config),
		"/** @type {readonly string[]} */",
		`export const prefixes = ${JSON.stringify(config.urlRouting.prefixes)};`,
		"/** @type {readonly RegExp[]} */",
		`export const unlocalizedPaths = [${config.urlRouting.unlocalizedPaths.map((glob) => String(globPattern(glob))).join(", ")}];`,
		...pathnamesTable(config.urlRouting.pathnames),
		`export const basePath = ${JSON.stringify(config.urlRouting.basePath)};`,
		"/** @type {readonly string[]} */",
		`export const domains = ${JSON.stringify(config.urlRouting.domains)};`,
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
export function directionOf(locale: string): "ltr" | "rtl" {
	const script = new Intl.Locale(locale).maximize().script;
	return script !== undefined && rightToLeft.has(script) ? "rtl" : "ltr";
}

/**
 * What the strategy and the url strategy's options ask of the runtime, each a constant that a
 * bundler folds, so a page carries the code of only what its config uses.
 */
function strategyConstants(config: Config): string[] {
	const {
		localePrefix,
		prefixes,
		unlocalizedPaths,
		pathnames,
		basePath,
		domains,
	} = config.urlRouting;
	const constants = {
		readsUrl: config.strategy.includes("url"),
		// Every place but the browser's languages keeps a visitor's choice.
		keepsChoice: config.strategy.some(
			(source) => source !== "preferredLanguage",
		),
		prefixesEveryLocale: localePrefix === "always",
		customPrefixes: prefixes.some(
			(prefix, index) => prefix !== config.locales[index],
		),
		leavesPathsAlone: unlocalizedPaths.length > 0,
		translatesPaths: pathnames.length > 0,
		servedUnderBase: basePath !== "",
		hostsLocales: domains.length > 0,
	};
	return Object.entries(constants).map(
		([name, value]) => `export const ${name} = ${value};`,
	);
}
