/** Seeding a locale with the base locale's text. */

import { mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import { readCatalogSources } from "./catalog.ts";
import { appendMessages } from "./catalog-file.ts";
import { type CompileResult, compile, parseCatalogs } from "./compile.ts";
import { type Config, isRecord, readConfig } from "./config.ts";
import { sameJson } from "./edit.ts";
import { GraiError } from "./error.ts";
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
	const categories = new Set(categoriesOf(locale));
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
		const detail = `"${locale}" is not a locale to seed. Seed one of ${others.join(", ")}, from the base locale ${config.baseLocale}.`;
		return { errors: [new GraiError("config-invalid", where, detail)] };
	}
	// The locale's catalog may not exist yet, or hold nothing: that is what seeding is for.
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
	const target = parsed.catalogs.find((catalog) => catalog.locale === locale);
	const seeded: [string, unknown][] = [];
	const problems: GraiError[] = [];
	for (const [key, value] of base?.messages ?? []) {
		if (target?.messages.has(key)) continue;
		try {
			parseMessage(config.baseLocale, value);
			seeded.push([key, seedValue(value, locale)]);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			const where = { file: base?.file ?? "", key, locale: config.baseLocale };
			problems.push(new GraiError(error.code, where, error.message));
		}
	}
	if (problems.length > 0) return { errors: problems };
	if (seeded.length > 0) {
		mkdirSync(dirname(path), { recursive: true });
		appendMessages(
			path,
			seeded,
			config.catalogs.get(config.baseLocale) ?? path,
		);
	}
	return {
		file: relative(config.root, path),
		keys: seeded.length,
		result: await compile(configFile),
	};
}
