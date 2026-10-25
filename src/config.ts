import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { GraiError } from "./error.ts";
import { readFallbacks } from "./fallbacks.ts";
import { isGlob } from "./globs.ts";
import {
	type IdenticalToBase,
	readIdenticalToBase,
} from "./identical-to-base.ts";
import { categoriesOf, type PluralType } from "./plurals.ts";

/** A project's `grai.config.json`, read and checked. Paths are absolute. */
export type Config = {
	/** The directory of the config file, which relative paths start from. */
	root: string;
	locales: readonly string[];
	baseLocale: string;
	/** Each locale's catalog file, in `locales` order. */
	catalogs: ReadonlyMap<string, string>;
	outdir: string;
	/** Where the server's middleware looks for a request's locale, in order, before the base locale. */
	strategy: readonly Strategy[];
	/** The cookie the `cookie` strategy reads and `setLocale` writes. */
	cookieName: string | undefined;
	/** How a page changes locale. */
	switch: LocaleSwitch;
	/** Whether the `url` strategy's paths have a prefix for every locale, or for all but the base. */
	localePrefix: LocalePrefix;
	/** Globs of the paths the `url` strategy leaves alone, which the strategies after it localize. */
	unlocalizedPaths: readonly string[];
	/** Globs of the source files that are tests, by path from the root: a key only they name is unused. */
	tests: readonly string[];
	/** Each locale's keys whose message is the base text on purpose, which are not untranslated. */
	identicalToBase: IdenticalToBase;
	/** Each locale that takes the messages it lacks from another of its language, and that locale. */
	fallbacks: ReadonlyMap<string, string>;
	/** A locale made from the base's messages for development and tests, which no build ships. */
	pseudoLocale: string | undefined;
};

/**
 * How a page changes locale: by reloading, so its words are fixed while it lives (the default), or
 * in place, live.
 */
export type LocaleSwitch = "reload" | "live";

/** Which locales' paths the `url` strategy prefixes: all but the base locale's, or every one. */
export type LocalePrefix = "as-needed" | "always";

/** A place a request can name its locale in. */
export type Strategy = "cookie" | "preferredLanguage" | "url";

const strategies: ReadonlySet<string> = new Set([
	"cookie",
	"preferredLanguage",
	"url",
]);

const fields = new Set([
	"locales",
	"baseLocale",
	"catalogs",
	"outdir",
	"strategy",
	"cookieName",
	"switch",
	"localePrefix",
	"unlocalizedPaths",
	"tests",
	"identicalToBase",
	"fallbacks",
	"pseudoLocale",
]);
const localePlaceholder = "{locale}";
/** A cookie's name: an HTTP token, the characters RFC 6265 allows in it. */
const cookieNameToken = /^[\w!#$%&'*+\-.^`|~]+$/;
/**
 * Test files as Vitest and Jest name them, Jest's `__tests__` folders, and the project's own
 * `test` and `tests` folders. A test ships nothing. A folder named `tests` deeper down may ship,
 * as a SvelteKit route at `src/routes/tests/` does, so only the root's are tests.
 */
const conventionalTests = [
	"**/*.{test,spec}.*",
	"**/__tests__/**",
	"test/**",
	"tests/**",
];

/** Reads a config file, or throws a `GraiError` naming what is missing or wrong. */
export function readConfig(file: string): Config {
	const where = { file: basename(file) };
	const raw = parse(readText(file, where), where);
	const invalid = (detail: string) =>
		new GraiError("config-invalid", where, `${detail}.`);

	for (const field of Object.keys(raw)) {
		if (!fields.has(field)) {
			throw invalid(
				`"${field}" is not a config field; the fields are ${[...fields].join(", ")}`,
			);
		}
	}
	const {
		locales,
		baseLocale,
		catalogs,
		outdir,
		strategy = [],
		cookieName,
		switch: localeSwitch = "reload",
		localePrefix,
		unlocalizedPaths = [],
		tests = conventionalTests,
		identicalToBase = {},
		fallbacks = {},
		pseudoLocale,
	} = raw;
	if (!isLocaleList(locales)) {
		throw invalid(
			'"locales" must be a non-empty list of distinct BCP 47 language tags, such as ["en", "de"]',
		);
	}
	for (const locale of locales) {
		const form = canonicalForm(locale);
		if (form !== locale) {
			throw invalid(
				`"locales" lists "${locale}", whose canonical form is "${form}". Write it so: the page's lang, the cookie and the URL are compared with it exactly`,
			);
		}
	}
	if (typeof baseLocale !== "string" || !locales.includes(baseLocale)) {
		throw invalid(
			`"baseLocale" must be one of "locales": ${locales.join(", ")}`,
		);
	}
	if (typeof catalogs !== "string" || !catalogs.includes(localePlaceholder)) {
		throw invalid(
			`"catalogs" must be a path with ${localePlaceholder} in it, such as "messages/${localePlaceholder}.json"`,
		);
	}
	if (typeof outdir !== "string" || outdir === "") {
		throw invalid('"outdir" must be the path of the output directory');
	}
	if (!isStrategy(strategy)) {
		throw invalid(
			'"strategy" must list where a request names its locale, each once: "cookie", "preferredLanguage" or "url"',
		);
	}
	if (localePrefix !== undefined && !strategy.includes("url")) {
		throw invalid(
			'"localePrefix" is read only by the "url" strategy, which "strategy" does not list',
		);
	}
	if (
		localePrefix !== undefined &&
		localePrefix !== "as-needed" &&
		localePrefix !== "always"
	) {
		throw invalid(
			'"localePrefix" must be "as-needed", where the base locale\'s paths have no prefix, or "always", where every locale\'s have one',
		);
	}
	if (!isPathPatternList(unlocalizedPaths)) {
		throw invalid(
			'"unlocalizedPaths" must list globs of paths, each starting with /, of *, **, ? and {a,b}, such as ["/api/**"]',
		);
	}
	if (unlocalizedPaths.length > 0 && !strategy.includes("url")) {
		throw invalid(
			'"unlocalizedPaths" is read only by the "url" strategy, which "strategy" does not list',
		);
	}
	const prefix: LocalePrefix = localePrefix ?? "as-needed";
	const urlFindsAll = prefix === "as-needed" && unlocalizedPaths.length === 0;
	const shadowed = urlFindsAll ? afterUrl(strategy) : [];
	if (shadowed.length > 0) {
		const them = shadowed.length === 1 ? "it" : "them";
		throw invalid(
			`"strategy" lists ${shadowed.map((source) => `"${source}"`).join(", ")} after "url", which never gets to ${them}: a path without a locale prefix is the base locale's. Put ${them} before "url", prefix every locale's paths with "localePrefix": "always", or name the paths "url" leaves to ${them} in "unlocalizedPaths"`,
		);
	}
	const readsCookie = strategy.includes("cookie");
	if (readsCookie !== (typeof cookieName === "string" && cookieName !== "")) {
		throw invalid(
			readsCookie
				? '"cookieName" must name the cookie the "cookie" strategy reads'
				: '"cookieName" is read only by the "cookie" strategy, which "strategy" does not list',
		);
	}
	if (typeof cookieName === "string" && !cookieNameToken.test(cookieName)) {
		throw invalid(
			'"cookieName" must be a cookie name, as RFC 6265 has it: letters, digits and !#$%&\'*+-.^_`|~, without spaces',
		);
	}
	if (localeSwitch !== "reload" && localeSwitch !== "live") {
		throw invalid(
			'"switch" must be "reload", where a page changes locale by reloading, or "live", where it changes in place',
		);
	}
	if (!isPatternList(tests)) {
		throw invalid(
			'"tests" must list globs of the test files, of *, **, ? and {a,b}, such as ["**/*.test.*"], or be [] when no file is a test',
		);
	}
	if (!isRecord(identicalToBase)) {
		throw invalid(
			'"identicalToBase" must map a locale to its keys whose message rightly reads as the base locale\'s, such as { "de": ["unit_km"] }',
		);
	}
	if (!isRecord(fallbacks)) {
		throw invalid(
			'"fallbacks" must map a locale to the locale of its language it takes the messages it lacks from, such as { "en-GB": "en" }',
		);
	}
	if (pseudoLocale !== undefined) {
		const problem = pseudoLocaleProblem(pseudoLocale, locales, baseLocale);
		if (problem !== undefined) throw invalid(problem);
	}
	const root = dirname(resolve(file));
	return {
		root,
		locales,
		baseLocale,
		catalogs: new Map(
			locales.map((locale) => [
				locale,
				resolve(root, catalogs.replaceAll(localePlaceholder, locale)),
			]),
		),
		outdir: resolve(root, outdir),
		strategy,
		cookieName: typeof cookieName === "string" ? cookieName : undefined,
		switch: localeSwitch,
		localePrefix: prefix,
		unlocalizedPaths,
		tests,
		identicalToBase: readIdenticalToBase(
			identicalToBase,
			locales,
			baseLocale,
			invalid,
		),
		fallbacks: readFallbacks(fallbacks, locales, baseLocale, invalid),
		pseudoLocale: typeof pseudoLocale === "string" ? pseudoLocale : undefined,
	};
}

/** The strategies listed after `url`, which finds a locale in every path and so ends the search. */
function afterUrl(strategy: readonly Strategy[]): readonly Strategy[] {
	const url = strategy.indexOf("url");
	return url === -1 ? [] : strategy.slice(url + 1);
}

/**
 * Why a pseudo-locale cannot be one, if it cannot: it must be a language tag of its own, and
 * choose among the base's plural categories, since its messages are the base's.
 */
function pseudoLocaleProblem(
	pseudoLocale: unknown,
	locales: readonly string[],
	baseLocale: string,
): string | undefined {
	if (
		typeof pseudoLocale !== "string" ||
		canonicalForm(pseudoLocale) !== pseudoLocale ||
		locales.includes(pseudoLocale)
	) {
		return '"pseudoLocale" must be a BCP 47 language tag in its canonical form that "locales" does not list, such as "en-XA"';
	}
	const types: readonly PluralType[] = ["cardinal", "ordinal"];
	for (const type of types) {
		const own = categoriesOf(pseudoLocale, type).join(", ");
		const base = categoriesOf(baseLocale, type).join(", ");
		if (own !== base) {
			return `"pseudoLocale" takes its plurals from ${baseLocale}, so it must have its ${type} categories, ${base}, and ${pseudoLocale} has ${own}. Name it after ${baseLocale}'s language, such as "${baseLocale.split("-")[0]}-XA"`;
		}
	}
	return undefined;
}

function isStrategy(value: unknown): value is Strategy[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" && strategies.has(item)) &&
		new Set(value).size === value.length
	);
}

/** Whether a value is a list of globs of URL paths, each starting with /. */
function isPathPatternList(value: unknown): value is string[] {
	return (
		isPatternList(value) && value.every((pattern) => pattern.startsWith("/"))
	);
}

function isPatternList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" && isGlob(item))
	);
}

function readText(file: string, where: { file: string }): string {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if (isMissing(error)) {
			throw new GraiError(
				"config-missing",
				where,
				`there is no config file at ${resolve(file)}. Create it with "locales", "baseLocale", "catalogs" and "outdir".`,
			);
		}
		throw new GraiError(
			"config-unreadable",
			where,
			`the config file cannot be read: ${String(error)}.`,
		);
	}
}

function parse(text: string, where: { file: string }): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new GraiError(
			"config-invalid",
			where,
			`the config file is not JSON: ${String(error)}.`,
		);
	}
	if (!isRecord(value)) {
		throw new GraiError(
			"config-invalid",
			where,
			"the config file must hold a JSON object.",
		);
	}
	return value;
}

function isLocaleList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((tag) => canonicalForm(tag) !== undefined) &&
		new Set(value).size === value.length
	);
}

/** A BCP 47 language tag's canonical form, or undefined for a value that is not one tag. */
function canonicalForm(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const forms = Intl.getCanonicalLocales(value);
		return forms.length === 1 ? forms[0] : undefined;
	} catch {
		return undefined;
	}
}

/** Whether a file system error says the file does not exist. */
export function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
