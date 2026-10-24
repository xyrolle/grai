/**
 * Seeding a locale with the base locale's text, and what is still untranslated: a message equal to
 * its seed. Nothing is kept beside the catalogs, since every key is in every locale anyway.
 */

import { mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { Catalog } from "./catalog.ts";
import { writeMessages } from "./catalog-file.ts";
import { type CompileResult, compile } from "./compile.ts";
import { isRecord } from "./config.ts";
import { sameJson } from "./edit.ts";
import { GraiError } from "./error.ts";
import { readLocaleCatalogs } from "./locale-catalogs.ts";
import { parseMessage } from "./message.ts";
import { parseDeclarations } from "./message-declarations.ts";
import { categoriesOf } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";
import { catchAll } from "./selection.ts";

/**
 * A base message as it is seeded into a locale: the same text. A plural keeps the variants the
 * locale can choose, and its `other` becomes `*` where there is no `*`, so it covers the locale's
 * categories the base locale lacks, such as `few`. Throws a MessageProblem for an invalid
 * declaration; the rest of the message is taken as it is.
 */
export function seedValue(value: unknown, locale: string): unknown {
	const fields = Array.isArray(value) ? value[0] : undefined;
	if (!isRecord(fields) || !isRecord(fields.match)) return value;
	const declarations = Array.isArray(fields.declarations)
		? fields.declarations.filter((item) => typeof item === "string")
		: [];
	const locals = parseDeclarations(declarations).plurals;
	const plurals = (
		Array.isArray(fields.selectors) ? fields.selectors : []
	).filter((name) => typeof name === "string" && locals.has(name));
	if (plurals.length === 0) return value;
	const variants = Object.entries(fields.match).map(
		([key, pattern]): [Map<string, string>, string, unknown] => [
			variantKeys(key),
			key,
			pattern,
		],
	);
	const categories = new Set(categoriesOf(locale, "cardinal"));
	const open = new Set(
		plurals.filter((name) =>
			variants.some(([keys]) => keys.get(name) === catchAll),
		),
	);
	const match: Record<string, unknown> = {};
	for (const [keys, written, pattern] of variants) {
		const seeded = new Map(keys);
		let chosen = true;
		for (const name of plurals) {
			const key = keys.get(name) ?? catchAll;
			if (key === "other" && !open.has(name)) seeded.set(name, catchAll);
			else if (!isPluralKey(key, categories)) chosen = false;
		}
		if (!chosen) continue;
		const same = [...keys].every(([name, key]) => seeded.get(name) === key);
		match[same ? written : variantKey(seeded)] = pattern;
	}
	return sameJson(match, fields.match) ? value : [{ ...fields, match }];
}

/** Whether a variant key can be chosen for a count in a locale: a category it has, a number or `*`. */
function isPluralKey(key: string, categories: ReadonlySet<string>): boolean {
	return (
		key === catchAll ||
		categories.has(key) ||
		(key.trim() !== "" && Number.isFinite(Number(key)))
	);
}

/** A variant key such as `countPlural=one,gender=*`, by selector. */
function variantKeys(key: string): Map<string, string> {
	return new Map(
		(key === "" ? [] : key.split(",")).map((part): [string, string] => {
			const [name = "", value = ""] = part
				.split("=")
				.map((side) => side.trim());
			return [name, value];
		}),
	);
}

function variantKey(keys: ReadonlyMap<string, string>): string {
	return [...keys].map(([name, key]) => `${name}=${key}`).join(",");
}

/**
 * The keys of each locale other than the base whose message is still its seed, the base text, in
 * the catalog's order. Only locales with any are listed.
 */
export function untranslatedKeys(
	catalogs: readonly Catalog[],
	baseLocale: string,
): Map<string, string[]> {
	const base = catalogs.find((catalog) => catalog.locale === baseLocale);
	const untranslated = new Map<string, string[]>();
	for (const catalog of catalogs) {
		if (base === undefined || catalog === base) continue;
		const keys: string[] = [];
		for (const [key, value] of catalog.messages) {
			const source = base.messages.get(key);
			if (source !== undefined && isSeed(value, source, catalog.locale)) {
				keys.push(key);
			}
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

/** What seeding wrote: the catalog, and how many keys it gave the base text. */
export type Seeded = { file: string; keys: number; result: CompileResult };

/**
 * Gives a locale's catalog the base text of every key it lacks, after the keys it has, creating
 * the catalog when there is none yet, then compiles. It writes nothing when the locale is not one
 * to seed, or a base message is invalid.
 */
export async function seed(
	configFile: string,
	locale: string,
): Promise<Seeded | { errors: GraiError[] }> {
	const read = await readLocaleCatalogs(configFile, locale, "seed");
	if ("errors" in read) return read;
	const { config, path, base, target } = read;
	const seeded: [string, unknown][] = [];
	const problems: GraiError[] = [];
	for (const [key, value] of base.messages) {
		if (target?.messages.has(key)) continue;
		try {
			parseMessage(config.baseLocale, value);
			seeded.push([key, seedValue(value, locale)]);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			const where = { file: base.file, key, locale: config.baseLocale };
			problems.push(new GraiError(error.code, where, error.message));
		}
	}
	if (problems.length > 0) return { errors: problems };
	if (seeded.length > 0) {
		mkdirSync(dirname(path), { recursive: true });
		writeMessages(path, seeded, config.catalogs.get(config.baseLocale) ?? path);
	}
	return {
		file: relative(config.root, path),
		keys: seeded.length,
		result: await compile(configFile),
	};
}
