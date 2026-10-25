/**
 * Seeding a locale with the base locale's text, and what is still untranslated: a message equal to
 * its seed. Nothing is kept beside the catalogs, since every key is in every locale anyway.
 */

import { mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { Catalog } from "./catalog.ts";
import { catalogWithMessages } from "./catalog-file.ts";
import type { KeyPath } from "./catalog-keys.ts";
import { type CompileResult, compile } from "./compile.ts";
import { sameJson } from "./edit.ts";
import { GraiError } from "./error.ts";
import type { IdenticalToBase } from "./identical-to-base.ts";
import { readLocaleCatalogs } from "./locale-catalogs.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { seedValue } from "./seed-value.ts";
import { writeAll } from "./write-all.ts";

/**
 * The keys of each locale other than the base whose message is still its seed, the base text, in
 * the catalog's order, but those `identical` lists for the locale. Only locales with any are listed.
 */
export function untranslatedKeys(
	catalogs: readonly Catalog[],
	baseLocale: string,
	identical: IdenticalToBase,
): Map<string, string[]> {
	const base = catalogs.find((catalog) => catalog.locale === baseLocale);
	const untranslated = new Map<string, string[]>();
	for (const catalog of catalogs) {
		if (base === undefined || catalog === base) continue;
		const listed = identical.get(catalog.locale);
		const keys: string[] = [];
		for (const [key, value] of catalog.messages) {
			const source = base.messages.get(key);
			const seeded =
				source !== undefined && isSeed(value, source, catalog.locale);
			if (seeded && !listed?.has(key)) keys.push(key);
		}
		if (keys.length > 0) untranslated.set(catalog.locale, keys);
	}
	return untranslated;
}

/** Whether a locale's message is still the seed of the base message `source`: untranslated. */
export function isSeed(
	value: unknown,
	source: unknown,
	locale: string,
): boolean {
	if (value === source || sameJson(value, source)) return true;
	// Only a plural can differ from the base text and still be its seed.
	if (!Array.isArray(value) || !Array.isArray(source)) return false;
	try {
		return sameJson(value, seedValue(source, locale));
	} catch (error) {
		if (error instanceof MessageProblem) return false;
		throw error;
	}
}

/**
 * Why a base message cannot be seeded, if it cannot: it is invalid, or its seed would not compile
 * in the locale. Either is an error, so that seeding never writes a catalog that fails.
 */
function seedProblem(
	key: string,
	value: unknown,
	file: string,
	baseLocale: string,
	locale: string,
): GraiError | undefined {
	let checked = baseLocale;
	try {
		parseMessage(baseLocale, value);
		checked = locale;
		parseMessage(locale, seedValue(value, locale));
		return undefined;
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		const detail =
			checked === baseLocale
				? error.message
				: `its seed would not compile in ${locale}: ${error.message}`;
		return new GraiError(error.code, { file, key, locale: checked }, detail);
	}
}

/** What seeding wrote: the catalog, and how many keys it gave the base text. */
export type Seeded = { file: string; keys: number; result: CompileResult };

/**
 * Gives a locale's catalog the base text of every key it lacks, after the keys it has, creating
 * the catalog when there is none yet, then compiles. It writes nothing when the locale is not one
 * to seed, a base message is invalid, or a seed would not compile in the locale.
 */
export async function seed(
	configFile: string,
	locale: string,
): Promise<Seeded | { errors: GraiError[] }> {
	const read = await readLocaleCatalogs(configFile, locale, "seed");
	if ("errors" in read) return read;
	const { config, path, base, target } = read;
	const seeded: [KeyPath, unknown][] = [];
	const problems: GraiError[] = [];
	for (const [key, value] of base.messages) {
		if (target?.messages.has(key)) continue;
		const problem = seedProblem(
			key,
			value,
			base.file,
			config.baseLocale,
			locale,
		);
		if (problem !== undefined) {
			problems.push(problem);
			continue;
		}
		seeded.push([base.paths.get(key) ?? [key], seedValue(value, locale)]);
	}
	if (problems.length > 0) return { errors: problems };
	if (seeded.length > 0) {
		mkdirSync(dirname(path), { recursive: true });
		const like = config.catalogs.get(config.baseLocale) ?? path;
		writeAll(new Map([[path, catalogWithMessages(path, seeded, like)]]));
	}
	return {
		file: relative(config.root, path),
		keys: seeded.length,
		result: await compile(configFile),
	};
}
