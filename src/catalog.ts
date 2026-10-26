import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type CatalogKeys, catalogKeys, type KeyPath } from "./catalog-keys.ts";
import { type Config, isMissing, isRecord } from "./config.ts";
import { editedMessages } from "./edit.ts";
import { GraiError } from "./error.ts";

/**
 * One of a locale's catalog files as read: its path relative to the project's root, its bytes,
 * whether the locale falls back to another, so that its catalog can be empty, and all the locale's
 * files, this one among them: one whose locale has others can be empty too.
 */
export type CatalogSource = {
	locale: string;
	file: string;
	bytes: Buffer;
	fallsBack: boolean;
	files: readonly string[];
};

/** One locale's catalog, parsed: its raw messages by key, and where each key is in the file. */
export type Catalog = {
	locale: string;
	file: string;
	messages: ReadonlyMap<string, unknown>;
	paths: ReadonlyMap<string, KeyPath>;
	/** This parse of the catalog, by which a later edit names the catalog it edited. */
	revision: symbol;
	/**
	 * For a catalog parsed from an edit: the revision of the catalog edited, the keys the edit
	 * touched, and whether a key now starts on another line. A revision, not the catalog: each edit
	 * would otherwise hold on to every catalog before it.
	 */
	edit?: { from: symbol; keys: ReadonlySet<string>; moved: boolean };
	/**
	 * For a locale whose messages are split across files: the files, in the order `catalogs` lists
	 * them, and the file each key is in.
	 */
	split?: { files: readonly string[]; fileOf: ReadonlyMap<string, string> };
};

/** The file a key of the catalog is in, or else the catalog's file. */
export function fileOfKey(catalog: Catalog, key: string): string {
	return catalog.split?.fileOf.get(key) ?? catalog.file;
}

/**
 * Which of the locale's files, in the order `catalogs` lists them, a key of the catalog is in: the
 * first, where a new key goes, unless a split catalog has the key in another.
 */
export function fileIndexOf(catalog: Catalog, key: string): number {
	const { split } = catalog;
	const file = split?.fileOf.get(key);
	return split === undefined || file === undefined
		? 0
		: split.files.indexOf(file);
}

/** The paths of the catalog's keys in the file at `index` of its locale's: all of them, unless it is split. */
export function pathsInFile(
	catalog: Catalog,
	index: number,
): Iterable<KeyPath> {
	if (catalog.split === undefined) return catalog.paths.values();
	return [...catalog.paths]
		.filter(([key]) => fileIndexOf(catalog, key) === index)
		.map(([, path]) => path);
}

/**
 * Reads every locale's catalog files at once, in `locales` order and each locale's in the order
 * `catalogs` lists them. A file that cannot be read is an error naming it.
 */
export async function readCatalogSources(config: Config): Promise<{
	sources: CatalogSource[];
	errors: GraiError[];
}> {
	const results = await Promise.all(
		[...config.catalogs].flatMap(([locale, paths]) => {
			const named = paths.map((path) => ({
				path,
				file: relative(config.root, path),
			}));
			const files = named.map(({ file }) => file);
			return named.map(async ({ path, file }) => {
				try {
					return {
						locale,
						file,
						bytes: await readFile(path),
						fallsBack: config.fallbacks.has(locale),
						files,
					};
				} catch (error) {
					return unreadable(error, { file, locale }, path);
				}
			});
		}),
	);
	const sources: CatalogSource[] = [];
	const errors: GraiError[] = [];
	for (const result of results) {
		if (result instanceof GraiError) errors.push(result);
		else sources.push(result);
	}
	return { sources, errors };
}

function unreadable(
	error: unknown,
	where: { file: string; locale: string },
	path: string,
): GraiError {
	return isMissing(error)
		? new GraiError(
				"catalog-missing",
				where,
				`there is no catalog at ${path}. Create it, or fix "catalogs" in the config.`,
			)
		: new GraiError(
				"catalog-unreadable",
				where,
				`the catalog cannot be read: ${String(error)}.`,
			);
}

/**
 * Parses a catalog. One that is not a JSON object is an error, and so is one that holds no messages,
 * unless its locale falls back to another or has other files.
 */
export function parseCatalog(source: CatalogSource): Catalog {
	const { locale, file, bytes } = source;
	const where = { file, locale };
	let value: unknown;
	try {
		value = JSON.parse(bytes.toString("utf8"));
	} catch (error) {
		throw new GraiError(
			"catalog-invalid",
			where,
			`the catalog is not JSON: ${String(error)}.`,
		);
	}
	if (!isRecord(value)) {
		throw new GraiError(
			"catalog-invalid",
			where,
			"the catalog must hold a JSON object of messages by key.",
		);
	}
	return withKeys(source, catalogKeys(value, where));
}

/**
 * Parses an edited catalog, only the entries the edit changed when it can, from the catalog
 * parsed before the edit and the bytes it was parsed from.
 */
export function parseEditedCatalog(
	source: CatalogSource,
	previous: Catalog,
	previousBytes: Buffer,
): Catalog {
	const edited = editedMessages(previousBytes, previous, source.bytes);
	if (edited === undefined) return parseCatalog(source);
	return {
		...withKeys(source, edited),
		edit: { from: previous.revision, keys: edited.keys, moved: edited.moved },
	};
}

function withKeys(
	{ locale, file, fallsBack, files }: CatalogSource,
	{ messages, paths }: CatalogKeys,
): Catalog {
	if (messages.size === 0 && !fallsBack && files.length === 1) {
		throw empty(file, locale);
	}
	return { locale, file, messages, paths, revision: Symbol(locale) };
}

/** The error of a locale whose catalog holds no messages, and takes none from a fallback. */
export function empty(file: string, locale: string): GraiError {
	return new GraiError(
		"catalog-empty",
		{ file, locale },
		`the catalog has no messages, so ${locale} would render nothing. Add its messages, or remove ${locale} from "locales".`,
	);
}
