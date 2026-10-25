import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing, isRecord } from "../config.ts";
import { GraiError } from "../error.ts";
import type { ImportedKey } from "./catalogs.ts";
import { type ImportFormat, importFormats } from "./convert.ts";

/** The mapping's file, beside the config: it stays until the last call site is migrated. */
export const mappingFile = "grai.import.json";

/** What a call of a grai key takes: the inputs it reads, and whether it has markup to render. */
export type MappedKey = { key: string; inputs: string[]; markup?: true };

/**
 * How an imported project's calls become grai's: each key its source library's calls name, as
 * they name it, to the grai key and its inputs. A key the import left out has no entry.
 */
export type Mapping = {
	from: ImportFormat;
	keys: ReadonlyMap<string, MappedKey>;
};

/** The mapping's text, a key per entry in the order of the catalogs, tab-indented as they are. */
export function mappingText(
	from: ImportFormat,
	keys: readonly ImportedKey[],
): string {
	const entries = keys.map(({ calledBy, key, inputs, markup }) => [
		calledBy,
		markup ? { key, inputs, markup } : { key, inputs },
	]);
	const mapping = { from, keys: Object.fromEntries(entries) };
	return `${JSON.stringify(mapping, null, "\t")}\n`;
}

/** The mapping in a project's root. A missing or malformed one is an error that says what to do. */
export function readMapping(root: string): Mapping {
	const where = { file: mappingFile };
	let text: string;
	try {
		text = readFileSync(join(root, mappingFile), "utf8");
	} catch (error) {
		if (!isMissing(error)) throw error;
		throw new GraiError(
			"mapping-missing",
			where,
			"there is no mapping of the import's keys. Run grai import first: it writes this file.",
		);
	}
	const invalid = new GraiError(
		"mapping-invalid",
		where,
		"it is not a mapping grai import writes. Run grai import again to write it anew.",
	);
	let mapping: unknown;
	try {
		mapping = JSON.parse(text);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		throw invalid;
	}
	if (!isRecord(mapping) || !isRecord(mapping.keys)) throw invalid;
	const from = importFormats.find((format) => format === mapping.from);
	if (from === undefined) throw invalid;
	const keys = new Map<string, MappedKey>();
	for (const [calledBy, value] of Object.entries(mapping.keys)) {
		const mapped = mappedKey(value);
		if (mapped === undefined) throw invalid;
		keys.set(calledBy, mapped);
	}
	return { from, keys };
}

function mappedKey(value: unknown): MappedKey | undefined {
	if (!isRecord(value) || typeof value.key !== "string") return undefined;
	const { key, inputs, markup } = value;
	if (!Array.isArray(inputs)) return undefined;
	const names = inputs.filter((input) => typeof input === "string");
	if (names.length !== inputs.length) return undefined;
	if (markup === true) return { key, inputs: names, markup };
	return markup === undefined ? { key, inputs: names } : undefined;
}
