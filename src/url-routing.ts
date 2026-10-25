/**
 * The config's fields the `url` strategy reads: which locales' paths have a prefix, and the paths
 * it leaves alone. Without the strategy none of them is read, so none is taken.
 */

import type { GraiError } from "./error.ts";
import { isGlob } from "./globs.ts";

/** Which locales' paths the `url` strategy prefixes: all but the base locale's, or every one. */
export type LocalePrefix = "as-needed" | "always";

export type UrlRouting = {
	localePrefix: LocalePrefix;
	/** Globs of the paths the `url` strategy leaves alone, which the strategies after it localize. */
	unlocalizedPaths: readonly string[];
};

export const urlRoutingFields = ["localePrefix", "unlocalizedPaths"] as const;

/**
 * The config's `url` routing, checked: `strategy` must list `url` for any of it, and a strategy may
 * follow `url` only where a path can name no locale.
 */
export function readUrlRouting(
	raw: Readonly<Record<string, unknown>>,
	strategy: readonly string[],
	invalid: (detail: string) => GraiError,
): UrlRouting {
	const readsUrl = strategy.includes("url");
	const stray = urlRoutingFields.find((field) => raw[field] !== undefined);
	if (!readsUrl && stray !== undefined) {
		throw invalid(
			`"${stray}" is read only by the "url" strategy, which "strategy" does not list`,
		);
	}
	const { localePrefix = "as-needed", unlocalizedPaths = [] } = raw;
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
	return { localePrefix, unlocalizedPaths };
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
