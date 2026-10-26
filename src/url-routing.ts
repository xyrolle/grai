/**
 * The config's fields the `url` strategy reads: which locales' paths have a prefix, each locale's
 * prefix, the paths it leaves alone, each route's path in each locale's words, the base path the
 * app is served under, and each locale's host. Without the strategy none of them is read, so none
 * is taken.
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
	/** The path the app is served under, such as `/shop`, or `""` for none. */
	basePath: string;
	/** Each locale's host, in `locales` order, where the config gives every locale one; else none. */
	domains: readonly string[];
};

export const urlRoutingFields = [
	"localePrefix",
	"localePrefixes",
	"unlocalizedPaths",
	"pathnames",
	"basePath",
	"domains",
] as const;

/** A base path: one or more path segments, without a trailing slash. */
const basePathForm = /^(?:\/[^/?#\s]+)+$/;

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
		basePath,
		domains,
	} = raw;
	if (localePrefix !== "as-needed" && localePrefix !== "always") {
		throw invalid(
			'"localePrefix" must be "as-needed", where the base locale\'s paths have no prefix, or "always", where every locale\'s have one',
		);
	}
	if (
		basePath !== undefined &&
		(typeof basePath !== "string" || !basePathForm.test(basePath))
	) {
		throw invalid(
			'"basePath" must be the path the app is served under, as its framework has it, such as "/shop": it starts with / and does not end with one',
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
		basePath: basePath ?? "",
		domains:
			domains === undefined ? [] : readDomains(domains, locales, invalid),
	};
}

/** A host as a request names it: a lowercase name, and its port if it has one. */
const hostForm = /^[a-z\d-]+(?:\.[a-z\d-]+)*(?::\d{1,5})?$/;

/**
 * Each locale's host, which `domains` must give every locale, each its own: a locale without one
 * would have no address that a link from another's host could name.
 */
function readDomains(
	value: unknown,
	locales: readonly string[],
	invalid: (detail: string) => GraiError,
): readonly string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalid(
			'"domains" must map each locale to its host, such as { "en": "example.com", "de": "example.de" }',
		);
	}
	const given = new Map(Object.entries(value));
	const stranger = [...given.keys()].find(
		(locale) => !locales.includes(locale),
	);
	if (stranger !== undefined) {
		throw invalid(
			`"domains" names ${JSON.stringify(stranger)}, which is not one of "locales": ${locales.join(", ")}`,
		);
	}
	const hosts = new Map<string, string>();
	return locales.map((locale) => {
		const host = given.get(locale);
		if (host === undefined) {
			throw invalid(
				`"domains" must give every locale its host, and gives none to ${locale}`,
			);
		}
		if (typeof host !== "string" || !hostForm.test(host)) {
			throw invalid(
				`"domains" gives ${locale} ${JSON.stringify(host)}, but a host is a lowercase name, such as "example.de", with a port if it has one`,
			);
		}
		const other = hosts.get(host);
		if (other !== undefined) {
			throw invalid(
				`"domains" gives ${locale} "${host}", which is ${other}'s host too. Give each locale a host of its own`,
			);
		}
		hosts.set(host, locale);
		return host;
	});
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
