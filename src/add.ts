import type { Catalog } from "./catalog.ts";
import { catalogWithMessages } from "./catalog-file.ts";
import {
	type CompileResult,
	compile,
	parseCatalogs,
	readProject,
} from "./compile.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isKeyName } from "./key-checks.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { writeAll } from "./write-all.ts";

/**
 * Adds a key to every catalog that lacks it, with its text in each of those locales, then compiles.
 * A locale that falls back to another needs no text of its own, though it may be given one. It
 * writes nothing unless some text is to be added, one is given for each other locale that lacks the
 * key and for no locale that has it, and every text is a valid message.
 */
export async function add(
	configFile: string,
	key: string,
	texts: Readonly<Record<string, string>>,
): Promise<CompileResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return { written: [], errors: read.errors };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { written: [], errors };
	const base = catalogs.find(
		(catalog) => catalog.locale === read.config.baseLocale,
	);
	const where = { file: base?.file ?? "", key };
	const invalid = invalidName(key, catalogs, where);
	const problems =
		invalid === undefined
			? textProblems(catalogs, texts, read.config.fallbacks, where)
			: [invalid];
	if (problems.length > 0) return { written: [], errors: sortErrors(problems) };
	const catalogTexts = new Map<string, string>();
	for (const [locale, path] of read.config.catalogs) {
		const text = texts[locale];
		if (text !== undefined) {
			catalogTexts.set(path, catalogWithMessages(path, [[[key], text]], path));
		}
	}
	writeAll(catalogTexts);
	return compile(configFile);
}

/** Why the key cannot name a message, if it cannot: it is no identifier, or another key's case. */
function invalidName(
	key: string,
	catalogs: readonly Catalog[],
	where: { file: string; key: string },
): GraiError | undefined {
	if (!isKeyName(key)) {
		return new GraiError(
			"key-invalid",
			where,
			"a key must be a JavaScript identifier and not a reserved word. Use letters, digits, _ and $.",
		);
	}
	const other = catalogs
		.flatMap((catalog) => [...catalog.messages.keys()])
		.find((name) => name !== key && name.toLowerCase() === key.toLowerCase());
	return other === undefined
		? undefined
		: new GraiError(
				"key-invalid",
				where,
				`the key differs from "${other}" only in case. Choose another name.`,
			);
}

/**
 * What is wrong with the texts: there is nothing to add, as every catalog has the key or takes it
 * from its fallback and none is given a text; a catalog that lacks it and has no fallback has no
 * text, or an invalid one; or one that has it is given a text.
 */
function textProblems(
	catalogs: readonly Catalog[],
	texts: Readonly<Record<string, string>>,
	fallbacks: ReadonlyMap<string, string>,
	{ file, key }: { file: string; key: string },
): GraiError[] {
	const lacking = catalogs.filter((catalog) => !catalog.messages.has(key));
	const fromFallbacks = lacking.every(
		({ locale }) => fallbacks.has(locale) && texts[locale] === undefined,
	);
	if (fromFallbacks) {
		return [
			new GraiError(
				"key-exists",
				{ file, key },
				lacking.length === 0
					? "the key is already in the catalogs. Edit its messages there."
					: `the key is already in the catalogs, and ${lacking.map(({ locale }) => locale).join(", ")} take${lacking.length === 1 ? "s" : ""} it from a fallback. Edit its messages there, or give a locale its own text.`,
			),
		];
	}
	return catalogs.flatMap(
		(catalog) =>
			textProblem(
				catalog,
				key,
				texts[catalog.locale],
				fallbacks.has(catalog.locale),
			) ?? [],
	);
}

/** What is wrong with one catalog's text, if anything. One that falls back may have none. */
function textProblem(
	catalog: Catalog,
	key: string,
	text: string | undefined,
	fallsBack: boolean,
): GraiError | undefined {
	const where = { file: catalog.file, key, locale: catalog.locale };
	if (catalog.messages.has(key)) {
		return text === undefined
			? undefined
			: new GraiError(
					"key-exists",
					where,
					`the key is already in ${catalog.locale}. Edit its message there, and give a text only for the locales that lack the key.`,
				);
	}
	if (text === undefined) {
		return fallsBack
			? undefined
			: new GraiError(
					"key-missing",
					where,
					`give the key's text in ${catalog.locale} too, with --${catalog.locale}.`,
				);
	}
	try {
		parseMessage(catalog.locale, text);
		return undefined;
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return new GraiError(error.code, where, error.message);
	}
}
