import type { AstroConfig } from "astro";
import { baseDisagreement } from "../base-agreement.ts";
import type { Config } from "../config.ts";
import { globMatcher } from "../globs.ts";

/** What of Astro's config grai's has to agree with. */
export type AstroRouting = Pick<AstroConfig, "base" | "i18n"> & {
	image: { endpoint: { route: string } };
};
type I18n = NonNullable<AstroRouting["i18n"]>;

/**
 * A locale Astro routes: as grai names it, which is `Astro.currentLocale`, its URLs' prefix, and
 * whether Astro's config writes it as a tag rather than as `{ path, codes }`.
 */
type RoutedLocale = { locale: string; prefix: string; asTag: boolean };

/**
 * The prefix Astro's links give a locale written as a tag: `getRelativeLocaleUrl` lowercases it,
 * as its `normalizeLocale` option does by default, so `pt-BR`'s pages are linked under `/pt-br/`.
 */
const linkedPrefix = (tag: string) => tag.replaceAll("_", "-").toLowerCase();

/**
 * Each way Astro's config disagrees with grai's on where a page's locale comes from, as a
 * sentence that says what to set; none when they agree.
 * - With Astro's i18n routing, a page's locale is the one its URL names (`Astro.currentLocale`),
 *   so grai reads the URL first, for the same locales under the same prefixes, with the same
 *   default, prefixed in both or in neither. A path outside Astro's routing is one of grai's
 *   `unlocalizedPaths`, whose locale the strategies after `url` find.
 * - grai's `url` strategy finds the locale in the path's first segment after the base path, so
 *   Astro's base is grai's `basePath`, and no locale has a domain of its own.
 * - With every locale's paths prefixed, grai sends a request without a prefix to its locale's path,
 *   so Astro's own routes, which have none, are `unlocalizedPaths`.
 */
export function disagreements(grai: Config, astro: AstroRouting): string[] {
	const base = baseDisagreement(grai, {
		option: "Astro's base",
		base: astro.base,
	});
	return [
		...(base === undefined ? [] : [base]),
		...ownRouteDisagreements(grai, astro),
		...(astro.i18n === undefined
			? domainDisagreements(grai, undefined, [])
			: routingDisagreements(grai, astro.i18n)),
	];
}

/**
 * Astro's own routes, each as a glob of its paths and one path it serves: its image endpoint, its
 * server islands, and its error pages, which Astro renders at their own paths when it prerenders them.
 */
const ownRoutes = (astro: AstroRouting) => [
	{ glob: astro.image.endpoint.route, path: astro.image.endpoint.route },
	{ glob: "/_server-islands/**", path: "/_server-islands/island" },
	{ glob: "/404", path: "/404" },
	{ glob: "/500", path: "/500" },
];

function ownRouteDisagreements(grai: Config, astro: AstroRouting): string[] {
	const { localePrefix, unlocalizedPaths } = grai.urlRouting;
	if (!grai.strategy.includes("url") || localePrefix !== "always") return [];
	const leftAlone = globMatcher(unlocalizedPaths);
	const missing = ownRoutes(astro).filter(({ path }) => !leftAlone(path));
	if (missing.length === 0) return [];
	const globs = [...unlocalizedPaths, ...missing.map(({ glob }) => glob)];
	return [
		`With "localePrefix": "always", grai sends a request without a locale prefix to its locale's path, and Astro's own ${missing.map(({ glob }) => glob).join(", ")} have none. Set "unlocalizedPaths": ${JSON.stringify(globs)} in grai's config.`,
	];
}

function routingDisagreements(grai: Config, i18n: I18n): string[] {
	const routed = routedLocales(i18n);
	return [
		...strategyDisagreements(grai),
		...localeDisagreements(grai, routed),
		...defaultDisagreements(grai, i18n, routed),
		...domainDisagreements(grai, i18n, routed),
	];
}

/** Each locale Astro routes: a locale written as a tag is its own prefix, `{ path, codes }` is its first code's. */
function routedLocales(i18n: I18n): RoutedLocale[] {
	return i18n.locales.map((entry) =>
		typeof entry === "string"
			? { locale: entry, prefix: entry, asTag: true }
			: { locale: entry.codes[0], prefix: entry.path, asTag: false },
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
	return prefixed.flatMap(({ locale, prefix, asTag }) => {
		const graiPrefix =
			grai.urlRouting.prefixes[grai.locales.indexOf(locale)] ?? locale;
		const linked = linkedPrefix(locale);
		if (asTag && linked !== locale) {
			return [
				`Astro links ${locale}'s pages under /${linked}/, its tag lowercased, where the "url" strategy reads /${graiPrefix}/. List it in Astro's i18n.locales as { path: ${JSON.stringify(linked)}, codes: [${JSON.stringify(locale)}] }, and set "localePrefixes": { ${JSON.stringify(locale)}: ${JSON.stringify(linked)} } in grai's config.`,
			];
		}
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

/**
 * grai's hosts beside Astro's i18n.domains: each locale Astro serves from a domain of its own has
 * that host in grai's `domains`, and each locale but the default, which Astro serves at its site,
 * has its grai host listed in i18n.domains.
 */
function domainDisagreements(
	grai: Config,
	i18n: I18n | undefined,
	routed: RoutedLocale[],
): string[] {
	const astro = new Map(
		Object.entries(i18n?.domains ?? {}).map(([key, url]) => [
			routed.find(({ prefix }) => prefix === key)?.locale ?? key,
			new URL(url).host,
		]),
	);
	const hosts = grai.urlRouting.domains;
	if (hosts.length === 0) {
		return astro.size === 0
			? []
			: [
					`Astro's i18n.domains serves ${[...astro.keys()].join(", ")} from domains of their own, which grai's "url" strategy reads only with "domains" in grai's config. Give each locale its host there, such as { ${[...astro].map(([locale, host]) => `"${locale}": "${host}"`).join(", ")} } beside the default locale's.`,
				];
	}
	return grai.locales.flatMap((locale, index) => {
		const host = hosts[index] ?? "";
		const served = astro.get(locale);
		if (served === undefined) {
			return locale === grai.baseLocale
				? []
				: [
						`grai's "domains" gives ${locale} the host "${host}", which Astro's i18n.domains does not list. Add "${locale}": "https://${host}" there.`,
					];
		}
		return served === host
			? []
			: [
					`Astro's i18n.domains serves ${locale} from "${served}", and grai's "domains" gives it "${host}". Give each locale the same host in both.`,
				];
	});
}
