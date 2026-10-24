import type { GraiError } from "../error.ts";
import type { ImportedMessage, SourceEntry } from "./converted.ts";
import { convertI18next } from "./i18next.ts";
import { convertIcu } from "./icu.ts";
import { KeyNames } from "./keys.ts";
import { readEntries, type Source } from "./sources.ts";

/** The libraries whose catalogs grai imports. */
export const importFormats = ["i18next", "icu"] as const;
export type ImportFormat = (typeof importFormats)[number];

/** A converted message, with the source file and key the report names it by. */
export type KeyedMessage = ImportedMessage & {
	file: string;
	sourceKey: string;
};

/** Each locale's converted messages, by grai key. */
export type MessagesByLocale = ReadonlyMap<
	string,
	ReadonlyMap<string, KeyedMessage>
>;

const converters: Record<
	ImportFormat,
	(entries: readonly SourceEntry[], locale: string) => ImportedMessage[]
> = { i18next: convertI18next, icu: convertIcu };

/**
 * Converts every source's messages and names each by its grai key, in each of the locales. When
 * the sources hold several namespaces, each key starts with its own. Two source keys that become
 * one grai key, ignoring case, are an error.
 */
export function convertSources(
	sources: readonly Source[],
	format: ImportFormat,
	locales: readonly string[],
	errors: GraiError[],
): MessagesByLocale {
	const messages = new Map(
		locales.map((locale) => [locale, new Map<string, KeyedMessage>()]),
	);
	const names = new KeyNames();
	const namespaced =
		new Set(sources.map((source) => source.namespace)).size > 1;
	for (const source of sources) {
		const namespace = namespaced ? source.namespace : "";
		const converted = converters[format](
			readEntries(source, errors),
			source.locale,
		);
		for (const message of converted) {
			const dotted = message.path.join(".");
			const sourceKey = namespace === "" ? dotted : `${namespace}:${dotted}`;
			const path =
				namespace === "" ? message.path : [namespace, ...message.path];
			const key = names.name(path, sourceKey, source.file);
			messages
				.get(source.locale)
				?.set(key, { ...message, file: source.file, sourceKey });
		}
	}
	errors.push(...names.collisions());
	return messages;
}
