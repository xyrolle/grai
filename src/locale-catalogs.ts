/** Reading a project for a command that works on one locale other than the base: seed, export, merge. */

import { relative } from "node:path";
import { type Catalog, readCatalogSources } from "./catalog.ts";
import { parseCatalogs } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { fallbackPositions, messageSource } from "./fallbacks.ts";

/** A project's config, its base catalog, and the locale's own, which may not exist yet. */
export type LocaleCatalogs = {
	config: Config;
	/** Where the locale's catalog is, or goes. */
	path: string;
	base: Catalog;
	target: Catalog | undefined;
	/** The locale's keys whose message is the base text on purpose. */
	identical: ReadonlySet<string>;
	/** The message the locale takes from its fallbacks for a key its catalog lacks, if one has it. */
	inherited: Inherited;
};

/** The message a locale takes for a key from the first locale along its fallbacks that has it. */
export type Inherited = (key: string) => unknown;

/**
 * Reads a project for a command on `locale`, which must be one of its locales other than the base.
 * The locale's catalog may be missing or empty, as when it is new; any other error is returned.
 * `doing` names the command's work in the error for another locale, such as "seed".
 */
export async function readLocaleCatalogs(
	configFile: string,
	locale: string,
	doing: string,
): Promise<LocaleCatalogs | { errors: GraiError[] }> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return { errors: [error] };
		throw error;
	}
	const path = config.catalogs.get(locale);
	if (path === undefined || locale === config.baseLocale) {
		const others = config.locales.filter(
			(other) => other !== config.baseLocale,
		);
		const where = { file: relative(config.root, configFile) };
		const detail = `"${locale}" is not a locale to ${doing}: name one of ${others.join(", ")}; ${config.baseLocale} is the base locale.`;
		return { errors: [new GraiError("config-invalid", where, detail)] };
	}
	const absent = (error: GraiError) =>
		(error.code === "catalog-missing" || error.code === "catalog-empty") &&
		error.locale === locale;
	const read = await readCatalogSources(config);
	const parsed = parseCatalogs(read.sources);
	const errors = [...read.errors, ...parsed.errors].filter(
		(error) => !absent(error),
	);
	if (errors.length > 0) return { errors };
	const base = parsed.catalogs.find(
		(catalog) => catalog.locale === config.baseLocale,
	);
	if (base === undefined)
		throw new Error("grai read no base catalog, and no error");
	const target = parsed.catalogs.find((catalog) => catalog.locale === locale);
	const identical = config.identicalToBase.get(locale) ?? new Set();
	const byLocale = config.locales.map((each) =>
		parsed.catalogs.find((catalog) => catalog.locale === each),
	);
	const fallbackOf = fallbackPositions(config.locales, config.fallbacks);
	const fallback = fallbackOf[config.locales.indexOf(locale)];
	const inherited: Inherited = (key) =>
		fallback === undefined
			? undefined
			: messageSource(key, fallback, byLocale, fallbackOf)?.messages.get(key);
	return { config, path, base, target, identical, inherited };
}
