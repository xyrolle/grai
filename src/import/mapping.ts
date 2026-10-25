import type { ImportedKey } from "./catalogs.ts";
import type { ImportFormat } from "./convert.ts";

/** The mapping's file, beside the config: it stays until the last call site is migrated. */
export const mappingFile = "grai.import.json";

/** What a call of a grai key takes: the inputs it reads, and whether it has markup to render. */
export type MappedKey = { key: string; inputs: string[]; markup?: true };

/**
 * How an imported project's calls become grai's: each key its source library's calls name, as
 * they name it, to the grai key and its inputs. A key the import left out has no entry.
 */
export type Mapping = { from: ImportFormat; keys: Record<string, MappedKey> };

/** The mapping's text, a key per entry in the order of the catalogs, tab-indented as they are. */
export function mappingText(
	from: ImportFormat,
	keys: readonly ImportedKey[],
): string {
	const mapping: Mapping = {
		from,
		keys: Object.fromEntries(
			keys.map(({ calledBy, key, inputs, markup }) => [
				calledBy,
				markup ? { key, inputs, markup } : { key, inputs },
			]),
		),
	};
	return `${JSON.stringify(mapping, null, "\t")}\n`;
}
