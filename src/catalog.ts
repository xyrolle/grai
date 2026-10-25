import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type CatalogKeys, catalogKeys, type KeyPath } from "./catalog-keys.ts";
import { type Config, isMissing, isRecord } from "./config.ts";
import { editedMessages } from "./edit.ts";
import { GraiError } from "./error.ts";

/**
 * One locale's catalog file as read: its path relative to the project's root, its bytes, and
 * whether the locale falls back to another, so that its catalog can be empty.
 */
export type CatalogSource = {
	locale: string;
	file: string;
	bytes: Buffer;
	fallsBack: boolean;
};

/** One locale's catalog, parsed: its raw messages by key, and where each key is in the file. */
export type Catalog = {
	locale: string;
	file: string;
	messages: ReadonlyMap<string, unknown>;
	paths: ReadonlyMap<string, KeyPath>;
	/**
	 * For a catalog parsed from an edit: the catalog edited, the keys the edit touched, and whether
	 * a key now starts on another line.
	 */
	edit?: { from: Catalog; keys: ReadonlySet<string>; moved: boolean };
};

/** Reads every locale's catalog file at once. A file that cannot be read is an error naming it. */
export async function readCatalogSources(config: Config): Promise<{
	sources: CatalogSource[];
	errors: GraiError[];
}> {
	const results = await Promise.all(
		[...config.catalogs].map(async ([locale, path]) => {
			const file = relative(config.root, path);
			try {
				return {
					locale,
					file,
					bytes: await readFile(path),
					fallsBack: config.fallbacks.has(locale),
				};
			} catch (error) {
				return unreadable(error, { file, locale }, path);
			}
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
 * unless its locale falls back to another.
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
		edit: { from: previous, keys: edited.keys, moved: edited.moved },
	};
}

function withKeys(
	{ locale, file, fallsBack }: CatalogSource,
	{ messages, paths }: CatalogKeys,
): Catalog {
	if (messages.size === 0 && !fallsBack) {
		throw new GraiError(
			"catalog-empty",
			{ file, locale },
			`the catalog has no messages, so ${locale} would render nothing. Add its messages, or remove ${locale} from "locales".`,
		);
	}
	return { locale, file, messages, paths };
}
