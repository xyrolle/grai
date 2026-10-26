/**
 * A locale's catalog made of its files' catalogs, for a config whose `catalogs` lists several
 * paths. With one path, a locale has one file, whose catalog is the locale's as it is.
 */

import { type Catalog, type CatalogSource, empty } from "./catalog.ts";
import type { KeyPath } from "./catalog-keys.ts";
import { GraiError } from "./error.ts";

/** A compile's catalogs: each file's, as its sources were read, and each locale's, made of them. */
export type ParsedCatalogs = {
	parts: readonly Catalog[];
	catalogs: readonly Catalog[];
};

/** A locale's catalog in a previous compile, and its files' catalogs then. */
type Before = { catalog: Catalog | undefined; files: readonly Catalog[] };

/**
 * Each locale's catalog, from the catalogs parsed from `sources`, which come a locale at a time:
 * `parts[index]` is `sources[index]`'s, undefined if it did not parse. A locale of one file has its
 * catalog as it is. A locale of several has one catalog of all their messages, which names each
 * key's file, and a key in two of them is an error naming both. A locale whose files are those of
 * `previous` keeps its catalog, and one with edited files is an edit of it.
 */
export function localeCatalogs(
	sources: readonly CatalogSource[],
	parts: readonly (Catalog | undefined)[],
	previous?: ParsedCatalogs,
): { catalogs: Catalog[]; errors: GraiError[] } {
	const catalogs: Catalog[] = [];
	const errors: GraiError[] = [];
	for (let start = 0; start < sources.length; ) {
		const source = sources[start];
		if (source === undefined) break;
		if (source.files.length === 1) {
			const part = parts[start];
			if (part !== undefined) catalogs.push(part);
			start++;
			continue;
		}
		let end = start + 1;
		while (end < sources.length && sources[end]?.locale === source.locale) {
			end++;
		}
		const before = previous && {
			catalog: previous.catalogs[catalogs.length],
			files: previous.parts.slice(start, end),
		};
		catalogs.push(
			splitCatalog(source, parts.slice(start, end), before, errors),
		);
		start = end;
	}
	return { catalogs, errors };
}

/**
 * The catalog of a locale whose messages are split across `files`, the first read from `first`:
 * the previous compile's while each file is the same, else one of their messages. Its files may be
 * empty, but not all of them, unless the locale falls back to another.
 */
function splitCatalog(
	first: CatalogSource,
	files: readonly (Catalog | undefined)[],
	before: Before | undefined,
	errors: GraiError[],
): Catalog {
	const old = before?.catalog;
	const catalog =
		old !== undefined &&
		files.every((file, index) => file === before?.files[index])
			? old
			: joined(first, files, errors, before);
	if (catalog.messages.size === 0 && !first.fallsBack) {
		errors.push(empty(catalog.file, catalog.locale));
	}
	return catalog;
}

/**
 * One catalog of a locale's files' messages, in the order `catalogs` lists the files. After an edit
 * of some of them, it is an edit of the catalog before, with the keys their edits touched.
 */
function joined(
	first: CatalogSource,
	files: readonly (Catalog | undefined)[],
	errors: GraiError[],
	before: Before | undefined,
): Catalog {
	const messages = new Map<string, unknown>();
	const paths = new Map<string, KeyPath>();
	const fileOf = new Map<string, string>();
	for (const file of files) {
		if (file === undefined) continue;
		for (const [key, message] of file.messages) {
			const other = fileOf.get(key);
			if (other !== undefined) {
				errors.push(duplicate(file, key, other));
				continue;
			}
			messages.set(key, message);
			fileOf.set(key, file.file);
			const path = file.paths.get(key);
			if (path !== undefined) paths.set(key, path);
		}
	}
	const edit = editOf(files, before);
	return {
		locale: first.locale,
		file: first.file,
		messages,
		paths,
		revision: Symbol(first.locale),
		...(edit === undefined ? {} : { edit }),
		split: { files: first.files, fileOf },
	};
}

/** The edit a locale's files make together, when each file that changed is an edit of its own. */
function editOf(
	files: readonly (Catalog | undefined)[],
	before: Before | undefined,
): Catalog["edit"] {
	if (before?.catalog === undefined) return undefined;
	const keys = new Set<string>();
	let moved = false;
	for (const [index, file] of files.entries()) {
		const old = before.files[index];
		if (file === old) continue;
		if (file?.edit === undefined || file.edit.from !== old?.revision) {
			return undefined;
		}
		for (const key of file.edit.keys) keys.add(key);
		moved ||= file.edit.moved;
	}
	return { from: before.catalog.revision, keys, moved };
}

function duplicate(file: Catalog, key: string, other: string): GraiError {
	return new GraiError(
		"key-exists",
		{ file: file.file, key, locale: file.locale },
		`the key is in ${other} too. Keep it in one of the locale's catalogs.`,
	);
}
