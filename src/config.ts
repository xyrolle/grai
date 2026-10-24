import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { GraiError } from "./error.ts";
import { isGlob } from "./globs.ts";
import {
	type IdenticalToBase,
	readIdenticalToBase,
} from "./identical-to-base.ts";

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
	/** Globs of the source files that are tests, by path from the root: a key only they name is unused. */
	tests: readonly string[];
	/** Each locale's keys whose message is the base text on purpose, which are not untranslated. */
	identicalToBase: IdenticalToBase;
};

/**
 * How a page changes locale: by reloading, so its words are fixed while it lives (the default), or
 * in place, live.
 */
export type LocaleSwitch = "reload" | "live";

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
	"tests",
	"identicalToBase",
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
		tests = conventionalTests,
		identicalToBase = {},
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
		tests,
		identicalToBase: readIdenticalToBase(
			identicalToBase,
			locales,
			baseLocale,
			invalid,
		),
	};
}

function isStrategy(value: unknown): value is Strategy[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" && strategies.has(item)) &&
		new Set(value).size === value.length
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
