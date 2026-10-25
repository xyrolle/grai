/**
 * The config's fields the `url` strategy reads: which locales' paths have a prefix, each locale's
 * prefix, the paths it leaves alone, and each route's path in each locale's words. Without the strategy none of them is read, so none is taken.
 */

import type { GraiError } from "./error.ts";
import { isGlob } from "./globs.ts";
import { type Pathname, readPathnames } from "./pathnames.ts";

/** Which locales' paths the `url` strategy prefixes: all but the base locale's, or every one. */
export type LocalePrefix = "as-needed" | "always";

export type UrlRouting = {
	localePrefix: LocalePrefix;
	/** Each locale's prefix, in `locales` order: its tag, or the segment `localePrefixes` gives it. */
	prefixes: readonly string[];
	/** Globs of the paths the `url` strategy leaves alone, which the strategies after it localize. */
	unlocalizedPaths: readonly string[];
	/** Each route's path in each locale's words, where the config gives one. */
	pathnames: readonly Pathname[];
};

export const urlRoutingFields = [
	"localePrefix",
	"localePrefixes",
	"unlocalizedPaths",
	"pathnames",
] as const;

/** A prefix of the config's own: one path segment, as a URL writes it without escapes. */
const segment = /^[a-z\d-]+$/;

/**
 * The config's `url` routing, checked: `strategy` must list `url` for any of it, a strategy may
 * follow `url` only where a path can name no locale, and each locale's prefix is its own.
 */
export function readUrlRouting(
	raw: Readonly<Record<string, unknown>>,
	strategy: readonly string[],
	locales: readonly string[],
	invalid: (detail: string) => GraiError,
): UrlRouting {
	const readsUrl = strategy.includes("url");
	const stray = urlRoutingFields.find((field) => raw[field] !== undefined);
	if (!readsUrl && stray !== undefined) {
		throw invalid(
			`"${stray}" is read only by the "url" strategy, which "strategy" does not list`,
		);
	}
	const {
		localePrefix = "as-needed",
		localePrefixes = {},
		unlocalizedPaths = [],
		pathnames = {},
	} = raw;
	if (localePrefix !== "as-needed" && localePrefix !== "always") {
		throw invalid(
			'"localePrefix" must be "as-needed", where the base locale\'s paths have no prefix, or "always", where every locale\'s have one',
		);
	}
	if (!isPathGlobList(unlocalizedPaths)) {
		throw invalid(
			'"unlocalizedPaths" must list globs of paths, each starting with /, of *, **, ? and {a,b}, such as ["/api/**"]',
		);
	}
	const shadowed = afterUrl(strategy);
	if (
		localePrefix === "as-needed" &&
		unlocalizedPaths.length === 0 &&
		shadowed.length > 0
	) {
		const them = shadowed.length === 1 ? "it" : "them";
		throw invalid(
			`"strategy" lists ${shadowed.map((source) => `"${source}"`).join(", ")} after "url", which never gets to ${them}: a path without a locale prefix is the base locale's. Put ${them} before "url", prefix every locale's paths with "localePrefix": "always", or name the paths "url" leaves to ${them} in "unlocalizedPaths"`,
		);
	}
	return {
		localePrefix,
		prefixes: readPrefixes(localePrefixes, locales, invalid),
		unlocalizedPaths,
		pathnames: readPathnames(pathnames, locales, invalid),
	};
}

/** Each locale's prefix, its tag unless `localePrefixes` gives it a segment of its own. */
function readPrefixes(
	value: unknown,
	locales: readonly string[],
	invalid: (detail: string) => GraiError,
): readonly string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalid(
			'"localePrefixes" must map a locale to the path segment its paths begin with, such as { "en-US": "us" }',
		);
	}
	const given = new Map(Object.entries(value));
	for (const [locale, prefix] of given) {
		if (!locales.includes(locale)) {
			throw invalid(
				`"localePrefixes" names ${JSON.stringify(locale)}, which is not one of "locales": ${locales.join(", ")}`,
			);
		}
		if (typeof prefix !== "string" || !segment.test(prefix)) {
			throw invalid(
				`"localePrefixes" gives ${locale} ${JSON.stringify(prefix)}, but a prefix is one path segment of lowercase letters, digits and hyphens, such as "us"`,
			);
		}
	}
	const prefixOf = (locale: string) => {
		const prefix = given.get(locale);
		return typeof prefix === "string" ? prefix : locale;
	};
	for (const locale of given.keys()) {
		const other = locales.find(
			(another) => another !== locale && prefixOf(another) === prefixOf(locale),
		);
		if (other !== undefined) {
			throw invalid(
				`"localePrefixes" gives ${locale} "${prefixOf(locale)}", which is ${other}'s prefix too. Give each locale a prefix of its own`,
			);
		}
	}
	return locales.map(prefixOf);
}

/** The strategies listed after `url`. */
function afterUrl(strategy: readonly string[]): readonly string[] {
	const url = strategy.indexOf("url");
	return url === -1 ? [] : strategy.slice(url + 1);
}

/** Whether a value is a list of globs of URL paths, each starting with /. */
function isPathGlobList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.every(
			(item) =>
				typeof item === "string" && item.startsWith("/") && isGlob(item),
		)
	);
}
