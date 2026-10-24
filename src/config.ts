import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { GraiError } from "./error.ts";

/** A project's `grai.config.json`, read and checked. Paths are absolute. */
export type Config = {
	/** The directory of the config file, which relative paths start from. */
	root: string;
	locales: readonly string[];
	baseLocale: string;
	/** Each locale's catalog file, in `locales` order. */
	catalogs: ReadonlyMap<string, string>;
	outdir: string;
	/** Where the server's middleware looks for a request's locale, in order, before the base locale. */
	strategy: readonly Strategy[];
	/** The cookie the `cookie` strategy reads and `setLocale` writes. */
	cookieName: string | undefined;
};

/** A place a request can name its locale in. */
export type Strategy = "cookie" | "preferredLanguage" | "url";

const strategies: ReadonlySet<string> = new Set([
	"cookie",
	"preferredLanguage",
	"url",
]);

const fields = new Set([
	"locales",
	"baseLocale",
	"catalogs",
	"outdir",
	"strategy",
	"cookieName",
]);
const localePlaceholder = "{locale}";

/** Reads a config file, or throws a `GraiError` naming what is missing or wrong. */
export function readConfig(file: string): Config {
	const where = { file: basename(file) };
	const raw = parse(readText(file, where), where);
	const invalid = (detail: string) =>
		new GraiError("config-invalid", where, `${detail}.`);

	for (const field of Object.keys(raw)) {
		if (!fields.has(field)) {
			throw invalid(
				`"${field}" is not a config field; the fields are ${[...fields].join(", ")}`,
			);
		}
	}
	const {
		locales,
		baseLocale,
		catalogs,
		outdir,
		strategy = [],
		cookieName,
	} = raw;
	if (!isLocaleList(locales)) {
		throw invalid(
			'"locales" must be a non-empty list of distinct BCP 47 language tags, such as ["en", "de"]',
		);
	}
	if (typeof baseLocale !== "string" || !locales.includes(baseLocale)) {
		throw invalid(
			`"baseLocale" must be one of "locales": ${locales.join(", ")}`,
		);
	}
	if (typeof catalogs !== "string" || !catalogs.includes(localePlaceholder)) {
		throw invalid(
			`"catalogs" must be a path with ${localePlaceholder} in it, such as "messages/${localePlaceholder}.json"`,
		);
	}
	if (typeof outdir !== "string" || outdir === "") {
		throw invalid('"outdir" must be the path of the output directory');
	}
	if (!isStrategy(strategy)) {
		throw invalid(
			'"strategy" must list where a request names its locale, each once: "cookie", "preferredLanguage" or "url"',
		);
	}
	const readsCookie = strategy.includes("cookie");
	if (readsCookie !== (typeof cookieName === "string" && cookieName !== "")) {
		throw invalid(
			readsCookie
				? '"cookieName" must name the cookie the "cookie" strategy reads'
				: '"cookieName" is read only by the "cookie" strategy, which "strategy" does not list',
		);
	}
	const root = dirname(resolve(file));
	return {
		root,
		locales,
		baseLocale,
		catalogs: new Map(
			locales.map((locale) => [
				locale,
				resolve(root, catalogs.replaceAll(localePlaceholder, locale)),
			]),
		),
		outdir: resolve(root, outdir),
		strategy,
		cookieName: typeof cookieName === "string" ? cookieName : undefined,
	};
}

function isStrategy(value: unknown): value is Strategy[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "string" && strategies.has(item)) &&
		new Set(value).size === value.length
	);
}

function readText(file: string, where: { file: string }): string {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if (isMissing(error)) {
			throw new GraiError(
				"config-missing",
				where,
				`there is no config file at ${resolve(file)}. Create it with "locales", "baseLocale", "catalogs" and "outdir".`,
			);
		}
		throw new GraiError(
			"config-unreadable",
			where,
			`the config file cannot be read: ${String(error)}.`,
		);
	}
}

function parse(text: string, where: { file: string }): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new GraiError(
			"config-invalid",
			where,
			`the config file is not JSON: ${String(error)}.`,
		);
	}
	if (!isRecord(value)) {
		throw new GraiError(
			"config-invalid",
			where,
			"the config file must hold a JSON object.",
		);
	}
	return value;
}

function isLocaleList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(isLanguageTag) &&
		new Set(value).size === value.length
	);
}

function isLanguageTag(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		return Intl.getCanonicalLocales(value).length === 1;
	} catch {
		return false;
	}
}

/** Whether a file system error says the file does not exist. */
export function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
