import type { Config } from "../config.ts";
import { fallbackPositions, messageSource } from "../fallbacks.ts";
import { type LocaleMessage, parseMessage } from "../message.ts";
import { MessageProblem } from "../problem.ts";
import type { KeyedMessage, MessagesByLocale } from "./convert.ts";
import { type CatalogValue, catalogValue } from "./converted.ts";
import { type ImportReport, type LocaleDetail, noticesOf } from "./report.ts";

/**
 * A grai catalog: its schema, then each key's message, in order. A map, so that a key such as
 * `__proto__` is an entry like any other.
 */
export type Catalog = Map<string, CatalogValue>;

/** A locale's new catalog, and the file it goes to. */
export type CatalogFile = { locale: string; path: string; catalog: Catalog };

/**
 * A key the import wrote, as its source library's calls name it, and what a grai call of it
 * takes: every input it reads in some locale, sorted, and whether it has markup in one.
 */
export type ImportedKey = {
	calledBy: string;
	key: string;
	inputs: string[];
	markup: boolean;
};

/** The catalogs of an import, the keys each holds, what the sources tell translators of them, and its report. */
export type ImportedCatalogs = ImportReport & {
	files: CatalogFile[];
	keys: ImportedKey[];
	descriptions: Map<string, string>;
};

/** Whether a locale's source lacks a key one along its fallbacks has, which compiling takes from there. */
type Inherits = (locale: string, key: string) => boolean;

/** A locale's catalog value for a key, the message it compiles to, and how its source calls it. */
type LocaleValue = {
	value: CatalogValue;
	compiled: LocaleMessage;
	calledBy: string;
};

const schema = "https://inlang.com/schema/inlang-message-format";

/**
 * A catalog for each configured locale, the base locale's keys in their order first. A locale's
 * catalog leaves out a key it takes from its fallbacks, as compiling does, so it keeps taking it. A
 * key that some locale cannot convert, or lacks with no fallback that has it, is left out of every
 * locale, with the reasons, so the catalogs compile. Every key goes in a locale's first
 * file, as a new key does, and a locale's other files are written without messages.
 */
export function catalogsOf(
	messages: MessagesByLocale,
	config: Config,
): ImportedCatalogs {
	const firsts = [...config.catalogs].map(
		([locale, [path]]): CatalogFile => ({
			locale,
			path,
			catalog: new Map([["$schema", schema]]),
		}),
	);
	const others = [...config.catalogs].flatMap(([locale, [, ...paths]]) =>
		paths.map(
			(path): CatalogFile => ({
				locale,
				path,
				catalog: new Map([["$schema", schema]]),
			}),
		),
	);
	const imported: ImportedCatalogs = {
		files: [...firsts, ...others],
		keys: [],
		descriptions: new Map(),
		leftOut: [],
		changed: [],
	};
	const inherits = inheritsIn(messages, config);
	for (const key of keysInOrder(messages, config.baseLocale)) {
		const values = valuesOf(key, messages, inherits, imported);
		if (values === undefined) continue;
		for (const { locale, catalog } of firsts) {
			const value = values.get(locale)?.value;
			if (value !== undefined) catalog.set(key, value);
		}
		const description = descriptionOf(key, messages, config.baseLocale);
		if (description !== undefined) imported.descriptions.set(key, description);
		imported.keys.push(importedKey(key, values));
	}
	return imported;
}

/** A written key, by its values in the locales, whose sources all call it alike. */
function importedKey(
	key: string,
	values: ReadonlyMap<string, LocaleValue>,
): ImportedKey {
	const inLocales = [...values.values()];
	const inputs = inLocales.flatMap(({ compiled }) => [...compiled.inputs]);
	return {
		calledBy: inLocales[0]?.calledBy ?? key,
		key,
		inputs: [...new Set(inputs)].sort(),
		markup: inLocales.some(({ compiled }) => compiled.markup),
	};
}

/** What the sources tell translators of a key: the base locale's source, or the first locale's that does. */
function descriptionOf(
	key: string,
	messages: MessagesByLocale,
	baseLocale: string,
): string | undefined {
	return [messages.get(baseLocale), ...messages.values()]
		.map((byKey) => byKey?.get(key)?.description)
		.find((description) => description !== undefined);
}

/** The import's `Inherits`, from the sources and the configured fallbacks. */
function inheritsIn(messages: MessagesByLocale, config: Config): Inherits {
	const { locales, fallbacks } = config;
	const sources = locales.map((locale) => ({
		messages: messages.get(locale) ?? new Map<string, KeyedMessage>(),
	}));
	const fallbackOf = fallbackPositions(locales, fallbacks);
	return (locale, key) => {
		const index = locales.indexOf(locale);
		const fallback = fallbackOf[index];
		return (
			!sources[index]?.messages.has(key) &&
			fallback !== undefined &&
			messageSource(key, fallback, sources, fallbackOf) !== undefined
		);
	};
}

/** Every key, the base locale's in its order first. */
function keysInOrder(
	messages: MessagesByLocale,
	baseLocale: string,
): Set<string> {
	const keys = new Set(messages.get(baseLocale)?.keys());
	for (const byKey of messages.values()) {
		for (const key of byKey.keys()) keys.add(key);
	}
	return keys;
}

/**
 * A key's value in each locale but those that take it from their fallbacks, or nothing, with the
 * reasons in the report, when one locale has none.
 */
function valuesOf(
	key: string,
	messages: MessagesByLocale,
	inherits: Inherits,
	report: ImportReport,
): Map<string, LocaleValue> | undefined {
	const inLocales = [...messages].map(([locale, byKey]) => ({
		locale,
		message: byKey.get(key),
	}));
	const named = inLocales.find(({ message }) => message !== undefined)?.message;
	const where = { file: named?.file ?? "", key: named?.sourceKey ?? key };
	const values = new Map<string, LocaleValue>();
	const problems: LocaleDetail[] = [];
	for (const { locale, message } of inLocales) {
		if (inherits(locale, key)) continue;
		try {
			values.set(locale, valueIn(locale, message));
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			problems.push({ locale, detail: error.message });
		}
	}
	if (problems.length > 0) {
		report.leftOut.push(...noticesOf(where, problems));
		return undefined;
	}
	const notes = inLocales.flatMap(({ locale, message }) =>
		(message?.notes ?? []).map((detail) => ({ locale, detail })),
	);
	report.changed.push(...noticesOf(where, notes));
	return values;
}

/** A locale's message as a catalog value that compiles; why it is not one is a MessageProblem. */
function valueIn(
	locale: string,
	message: KeyedMessage | undefined,
): LocaleValue {
	if (message === undefined) {
		throw new MessageProblem(
			"key-missing",
			"it has no message in this locale or any it falls back to, and every key needs one in each locale.",
		);
	}
	if (message.result instanceof MessageProblem) throw message.result;
	const value = catalogValue(message.result);
	const compiled = parseMessage(locale, value);
	return { value, compiled, calledBy: message.calledBy };
}
