import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type Config, isMissing, isRecord } from "./config.ts";
import { GraiError } from "./error.ts";

/** One locale's catalog file as read: its path relative to the project's root, and its bytes. */
export type CatalogSource = { locale: string; file: string; bytes: Buffer };

/** One locale's catalog, parsed: its raw messages by key. */
export type Catalog = {
	locale: string;
	file: string;
	messages: ReadonlyMap<string, unknown>;
};

/** The key the format reserves for the catalog's JSON schema; it is not a message. */
const schemaKey = "$schema";

/** Reads every locale's catalog file at once. A file that cannot be read is an error naming it. */
export async function readCatalogSources(config: Config): Promise<{
	sources: CatalogSource[];
	errors: GraiError[];
}> {
	const results = await Promise.all(
		[...config.catalogs].map(async ([locale, path]) => {
			const file = relative(config.root, path);
			try {
				return { locale, file, bytes: await readFile(path) };
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

/** Parses a catalog. One that is not a JSON object, or that holds no messages, is an error. */
export function parseCatalog({ locale, file, bytes }: CatalogSource): Catalog {
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
	const messages = new Map<string, unknown>();
	for (const key in value) {
		if (key !== schemaKey) messages.set(key, value[key]);
	}
	return withMessages({ locale, file }, messages);
}

function withMessages(
	{ locale, file }: { locale: string; file: string },
	messages: Map<string, unknown>,
): Catalog {
	if (messages.size === 0) {
		throw new GraiError(
			"catalog-empty",
			{ file, locale },
			`the catalog has no messages, so ${locale} would render nothing. Add its messages, or remove ${locale} from "locales".`,
		);
	}
	return { locale, file, messages };
}
