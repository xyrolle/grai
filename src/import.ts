import { join, relative } from "node:path";
import { type Config, readConfig } from "./config.ts";
import { descriptionsText } from "./descriptions.ts";
import { GraiError, sortErrors } from "./error.ts";
import { catalogsOf } from "./import/catalogs.ts";
import { convertSources, type ImportFormat } from "./import/convert.ts";
import { mappingText } from "./import/mapping.ts";
import { mappingFile } from "./import/mapping-file.ts";
import type { ImportReport } from "./import/report.ts";
import { findSources } from "./import/sources.ts";
import {
	existingCatalogs,
	unkeptDescriptions,
	writeCatalogs,
} from "./import/write.ts";

export { type ImportFormat, importFormats } from "./import/convert.ts";
export { mappingFile } from "./import/mapping-file.ts";
export {
	type ImportNotice,
	type ImportReport,
	reportLines,
	summaryLine,
} from "./import/report.ts";

export type ImportResult = ImportReport & {
	/** The catalogs written, relative to the project's root: none when there are errors. */
	written: string[];
	/** How many keys each catalog got. */
	keys: number;
	errors: GraiError[];
};

/**
 * Converts another library's catalogs into the project's grai catalogs, which must not exist yet,
 * and writes the mapping from each key the library's calls name to its grai key beside the config.
 * A message that cannot be converted in some locale is left out of every locale and reported, so
 * the catalogs compile. An unreadable source, a file whose locale is unclear, two keys that become
 * one, or a catalog that exists already is an error, and then nothing is written.
 */
export function importCatalogs(
	configFile: string,
	format: ImportFormat,
	inputs: readonly string[],
): ImportResult {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { written: [], keys: 0, leftOut: [], changed: [], errors: [error] };
	}
	const errors: GraiError[] = [];
	const sources = findSources(inputs, config, errors);
	const messages = convertSources(sources, format, config.locales, errors);
	const { files, keys, descriptions, leftOut, changed } = catalogsOf(
		messages,
		config,
	);
	errors.push(...existingCatalogs(files, config.root));
	errors.push(...unkeptDescriptions(descriptions, config, configFile));
	if (keys.length === 0 && errors.length === 0) {
		errors.push(
			new GraiError(
				"catalog-empty",
				{ file: relative(config.root, configFile) },
				"no message could be imported. The messages left out say why.",
			),
		);
	}
	const report = { keys: keys.length, leftOut, changed };
	if (errors.length > 0) {
		return { ...report, written: [], errors: sortErrors(errors) };
	}
	const others = new Map([
		[join(config.root, mappingFile), mappingText(format, keys)],
	]);
	if (config.descriptions !== undefined && descriptions.size > 0) {
		others.set(config.descriptions, descriptionsText(descriptions));
	}
	const written = writeCatalogs(files, others, config.root);
	return { ...report, written, errors: [] };
}
