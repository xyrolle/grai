import type { AstroConfig } from "astro";
import type { Config } from "../config.ts";

/** What of Astro's config grai's has to agree with. */
export type AstroRouting = Pick<AstroConfig, "base" | "i18n">;
type I18n = NonNullable<AstroRouting["i18n"]>;

/** A locale Astro routes: as grai names it, which is `Astro.currentLocale`, and its URLs' prefix. */
type RoutedLocale = { locale: string; prefix: string };

/**
 * Each way Astro's config disagrees with grai's on where a page's locale comes from, as a
 * sentence that says what to set; none when they agree.
 * - With Astro's i18n routing, a page's locale is the one its URL names (`Astro.currentLocale`),
 *   so grai reads the URL first, for the same locales under the same prefixes, with the same
 *   default, prefixed in both or in neither. A path outside Astro's routing is one of grai's
 *   `unlocalizedPaths`, whose locale the strategies after `url` find.
 * - grai's `url` strategy finds the locale in the path's first segment, so the site has no base,
 *   and no locale has a domain of its own.
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
				`The "url" strategy reads the locale from the path's first segment, which Astro's base ${JSON.stringify(base)} takes. Serve the site from Astro's base "/" ("The framework's base path" in grai's docs/followups.md).`,
			];
}

function routingDisagreements(grai: Config, i18n: I18n): string[] {
	const routed = routedLocales(i18n);
	return [
		...strategyDisagreements(grai),
		...localeDisagreements(grai, routed),
		...defaultDisagreements(grai, i18n, routed),
		...domainDisagreements(i18n),
	];
}

/** Each locale Astro routes: a locale written as a tag is its own prefix, `{ path, codes }` is its first code's. */
function routedLocales(i18n: I18n): RoutedLocale[] {
	return i18n.locales.map((entry) =>
		typeof entry === "string"
			? { locale: entry, prefix: entry }
			: { locale: entry.codes[0], prefix: entry.path },
	);
}

function strategyDisagreements({ strategy }: Config): string[] {
	if (strategy[0] === "url") return [];
	const first = ["url", ...strategy.filter((source) => source !== "url")];
	return [
		`Astro's i18n routing renders each page in the locale its URL names, so "url" must come first in "strategy": ${JSON.stringify(first)}, not ${JSON.stringify(strategy)}.`,
	];
}

/** grai's locales against Astro's, and each one's prefix: a tag, or the one `localePrefixes` gives. */
function localeDisagreements(grai: Config, routed: RoutedLocale[]): string[] {
	const astroLocales = routed.map(({ locale }) => locale);
	const sameLocales =
		astroLocales.length === grai.locales.length &&
		grai.locales.every((locale) => astroLocales.includes(locale));
	if (!sameLocales) {
		return [
			`Astro's i18n.locales must route grai's "locales", ${JSON.stringify(grai.locales)}, not ${JSON.stringify(astroLocales)}.`,
		];
	}
	// The base locale's URLs have a prefix only with "localePrefix": "always".
	const prefixed = routed.filter(
		({ locale }) =>
			locale !== grai.baseLocale || grai.urlRouting.localePrefix === "always",
	);
	return prefixed.flatMap(({ locale, prefix }) => {
		const graiPrefix =
			grai.urlRouting.prefixes[grai.locales.indexOf(locale)] ?? locale;
		if (graiPrefix === prefix) return [];
		return prefix === locale
			? [
					`grai serves ${locale} under /${graiPrefix}/ ("localePrefixes"), and Astro under /${locale}/. List it in Astro's i18n.locales as { path: ${JSON.stringify(graiPrefix)}, codes: [${JSON.stringify(locale)}] }.`,
				]
			: [
					`Astro serves ${locale} under /${prefix}/, and grai under /${graiPrefix}/. Set "localePrefixes": { ${JSON.stringify(locale)}: ${JSON.stringify(prefix)} } in grai's config.`,
				];
	});
}

/** The default locale: grai's base locale, prefixed in both or in neither. */
function defaultDisagreements(
	grai: Config,
	i18n: I18n,
	routed: RoutedLocale[],
): string[] {
	const problems: string[] = [];
	const astroDefault = routed.find(
		({ prefix }) => prefix === i18n.defaultLocale,
	);
	if (astroDefault?.locale !== grai.baseLocale) {
		const base = routed.find(({ locale }) => locale === grai.baseLocale);
		problems.push(
			`Astro's i18n.defaultLocale must be ${JSON.stringify(base?.prefix ?? grai.baseLocale)}, grai's "baseLocale", not ${JSON.stringify(i18n.defaultLocale)}.`,
		);
	}
	if (i18n.routing === "manual") return problems;
	const astroPrefixes = i18n.routing.prefixDefaultLocale;
	const graiPrefixes = grai.urlRouting.localePrefix === "always";
	if (astroPrefixes && !graiPrefixes) {
		problems.push(
			`Astro prefixes the default locale's URLs too (i18n.routing.prefixDefaultLocale). Set "localePrefix": "always" in grai's config.`,
		);
	}
	if (graiPrefixes && !astroPrefixes) {
		problems.push(
			`grai prefixes every locale's URLs ("localePrefix": "always"). Set Astro's i18n.routing.prefixDefaultLocale to true.`,
		);
	}
	return problems;
}

function domainDisagreements(i18n: I18n): string[] {
	const domains = Object.keys(i18n.domains ?? {});
	return domains.length === 0
		? []
		: [
				`Astro's i18n.domains serves ${domains.join(", ")} from domains of their own, where grai's "url" strategy finds the locale in the path. Remove i18n.domains and serve each locale under its path prefix ("A domain per locale" in grai's docs/followups.md).`,
			];
}
