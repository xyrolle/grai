import type { Config } from "../config.ts";
import { type LocaleMessage, parseMessage } from "../message.ts";
import { MessageProblem } from "../problem.ts";
import type { KeyedMessage, MessagesByLocale } from "./convert.ts";
import { type CatalogValue, catalogValue } from "./converted.ts";
import { type ImportReport, type LocaleDetail, noticesOf } from "./report.ts";

/** A grai catalog: its schema, then each key's message. */
export type Catalog = Record<string, CatalogValue>;

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

/** The catalogs of an import, the keys each holds, and its report. */
export type ImportedCatalogs = ImportReport & {
	files: CatalogFile[];
	keys: ImportedKey[];
};

/** A locale's catalog value for a key, the message it compiles to, and how its source calls it. */
type LocaleValue = {
	value: CatalogValue;
	compiled: LocaleMessage;
	calledBy: string;
};

const schema = "https://inlang.com/schema/inlang-message-format";

/**
 * A catalog for each configured locale, the base locale's keys in their order first. A key that
 * some locale lacks or cannot convert is left out of every locale, with the reasons, so the
 * catalogs compile.
 */
export function catalogsOf(
	messages: MessagesByLocale,
	config: Config,
): ImportedCatalogs {
	const imported: ImportedCatalogs = {
		files: [...config.catalogs].map(([locale, path]) => ({
			locale,
			path,
			catalog: { $schema: schema },
		})),
		keys: [],
		leftOut: [],
		changed: [],
	};
	for (const key of keysInOrder(messages, config.baseLocale)) {
		const values = valuesOf(key, messages, imported);
		if (values === undefined) continue;
		for (const { locale, catalog } of imported.files) {
			const value = values.get(locale)?.value;
			if (value !== undefined) catalog[key] = value;
		}
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

/** A key's value in each locale, or nothing, with the reasons in the report, when one locale has none. */
function valuesOf(
	key: string,
	messages: MessagesByLocale,
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
			"it has no message in this locale, and every key needs one in each locale.",
		);
	}
	if (message.result instanceof MessageProblem) throw message.result;
	const value = catalogValue(message.result);
	const compiled = parseMessage(locale, value);
	return { value, compiled, calledBy: message.calledBy };
}
