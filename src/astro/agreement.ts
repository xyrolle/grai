import type { AstroConfig } from "astro";
import type { Config } from "../config.ts";

/** What of Astro's config grai's has to agree with. */
export type AstroRouting = Pick<AstroConfig, "base" | "i18n">;

/**
 * Each way Astro's config disagrees with grai's on where a page's locale comes from, as a
 * sentence; none when they agree.
 * - With Astro's i18n routing, a page's locale is the one its URL names (`Astro.currentLocale`),
 *   so grai reads it from the URL alone, by the same locales, with the same default, which has
 *   no prefix in both.
 * - grai's `url` strategy finds the locale in the path's first segment, so the site has no base.
 */
export function disagreements(grai: Config, astro: AstroRouting): string[] {
	return [
		...(grai.strategy.includes("url") ? baseDisagreements(astro.base) : []),
		...(astro.i18n === undefined ? [] : routingDisagreements(grai, astro.i18n)),
	];
}

function baseDisagreements(base: string): string[] {
	return base.replaceAll("/", "") === ""
		? []
		: [
				`The "url" strategy reads the locale from the path's first segment, which Astro's base ${JSON.stringify(base)} takes. Serve the site from "/", or find the locale another way.`,
			];
}

function routingDisagreements(
	grai: Config,
	i18n: NonNullable<AstroRouting["i18n"]>,
): string[] {
	const problems: string[] = [];
	if (grai.strategy.length !== 1 || grai.strategy[0] !== "url") {
		problems.push(
			`Astro's i18n routing renders each page in the locale its URL names, so "strategy" must be ["url"], not ${JSON.stringify(grai.strategy)}.`,
		);
	}
	const paths = i18n.locales.flatMap((locale) =>
		typeof locale === "string" ? [] : [locale.path],
	);
	if (paths.length > 0) {
		problems.push(
			`Astro's i18n.locales names ${paths.map((path) => JSON.stringify(path)).join(", ")} by a path; the "url" strategy names a locale by its tag, so list the locales as their tags.`,
		);
	}
	const astroLocales = i18n.locales.flatMap((locale) =>
		typeof locale === "string" ? [locale] : [],
	);
	const missing = grai.locales.filter(
		(locale) => !astroLocales.includes(locale),
	);
	const extra = astroLocales.filter((locale) => !grai.locales.includes(locale));
	if (paths.length === 0 && (missing.length > 0 || extra.length > 0)) {
		problems.push(
			`Astro's i18n.locales must be grai's "locales": ${JSON.stringify(grai.locales)}, not ${JSON.stringify(astroLocales)}.`,
		);
	}
	if (i18n.defaultLocale !== grai.baseLocale) {
		problems.push(
			`Astro's i18n.defaultLocale must be grai's "baseLocale", ${JSON.stringify(grai.baseLocale)}, not ${JSON.stringify(i18n.defaultLocale)}.`,
		);
	}
	if (i18n.routing !== "manual" && i18n.routing.prefixDefaultLocale) {
		problems.push(
			`The base locale's URLs have no prefix in grai, so Astro's i18n.routing.prefixDefaultLocale must be false.`,
		);
	}
	const domains = Object.keys(i18n.domains ?? {});
	if (domains.length > 0) {
		problems.push(
			`Astro's i18n.domains serves ${domains.join(", ")} from domains of their own, where grai's "url" strategy finds the locale in the path. Serve every locale under its path prefix instead.`,
		);
	}
	return problems;
}
