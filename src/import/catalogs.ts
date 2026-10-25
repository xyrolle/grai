import type { Config } from "../config.ts";
import { parseMessage } from "../message.ts";
import { MessageProblem } from "../problem.ts";
import type { KeyedMessage, MessagesByLocale } from "./convert.ts";
import { type CatalogValue, catalogValue } from "./converted.ts";
import { type ImportReport, type LocaleDetail, noticesOf } from "./report.ts";

/** A grai catalog: its schema, then each key's message. */
export type Catalog = Record<string, CatalogValue>;

/** A locale's new catalog, and the file it goes to. */
export type CatalogFile = { locale: string; path: string; catalog: Catalog };

/** The catalogs of an import, how many keys each holds, what the sources tell translators of them, and its report. */
export type ImportedCatalogs = ImportReport & {
	files: CatalogFile[];
	keys: number;
	descriptions: Map<string, string>;
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
		keys: 0,
		descriptions: new Map(),
		leftOut: [],
		changed: [],
	};
	for (const key of keysInOrder(messages, config.baseLocale)) {
		const values = valuesOf(key, messages, imported);
		if (values === undefined) continue;
		for (const { locale, catalog } of imported.files) {
			const value = values.get(locale);
			if (value !== undefined) catalog[key] = value;
		}
		const description = descriptionOf(key, messages, config.baseLocale);
		if (description !== undefined) imported.descriptions.set(key, description);
		imported.keys++;
	}
	return imported;
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
): Map<string, CatalogValue> | undefined {
	const inLocales = [...messages].map(([locale, byKey]) => ({
		locale,
		message: byKey.get(key),
	}));
	const named = inLocales.find(({ message }) => message !== undefined)?.message;
	const where = { file: named?.file ?? "", key: named?.sourceKey ?? key };
	const values = new Map<string, CatalogValue>();
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
): CatalogValue {
	if (message === undefined) {
		throw new MessageProblem(
			"key-missing",
			"it has no message in this locale, and every key needs one in each locale.",
		);
	}
	if (message.result instanceof MessageProblem) throw message.result;
	const value = catalogValue(message.result);
	parseMessage(locale, value);
	return value;
}
