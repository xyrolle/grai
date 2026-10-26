/**
 * A framework's base path beside grai's `basePath`. Under the `url` strategy the locale follows
 * the base path, and grai's config names it, as its output is the same whichever tool compiles it,
 * so each adapter refuses a framework that serves the app under another.
 */

import type { Config } from "./config.ts";

/** A framework's base path as its config writes it, and the option that writes it. */
export type FrameworkBase = { option: string; base: string };

/** What to set where a framework's base path is not grai's `basePath`, under the url strategy. */
export function baseDisagreement(
	config: Config,
	{ option, base }: FrameworkBase,
): string | undefined {
	const { basePath } = config.urlRouting;
	// A framework writes its base with or without a trailing slash, and "/" for none.
	if (!config.strategy.includes("url") || base.replace(/\/+$/, "") === basePath)
		return undefined;
	return `${option} ${shown(base)} and grai's "basePath" ${shown(basePath)} must name the same path: the "url" strategy reads the locale after it.`;
}

function shown(base: string): string {
	return base.replace(/\/+$/, "") === "" ? "(none)" : JSON.stringify(base);
}
