import type { GetStaticPaths } from "astro";
import { baseLocale, locales } from "#lib/i18n/runtime.js";

/**
 * Each page once per locale, as `src/pages/[...locale]/` routes it: under the locale's prefix,
 * and the base locale's without one.
 */
export const getStaticPaths = (() =>
	locales.map((locale) => ({
		params: { locale: locale === baseLocale ? undefined : locale },
	}))) satisfies GetStaticPaths;
