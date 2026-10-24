/**
 * `grai export`: a locale's messages out to translators, as XLIFF 2.0 or as JSON for scripts.
 */

import { GraiError } from "./error.ts";
import { readLocaleCatalogs } from "./locale-catalogs.ts";
import { MessageProblem } from "./problem.ts";
import { writeUnitsJson } from "./translation-json.ts";
import { exportUnits } from "./translation-units.ts";
import { writeXliff } from "./xliff-writer.ts";

/** A locale's units as a document: XLIFF 2.0, or JSON. Only the untranslated ones when asked. */
export async function exportLocale(
	configFile: string,
	locale: string,
	options: { json: boolean; untranslated: boolean },
): Promise<{ document: string; units: number } | { errors: GraiError[] }> {
	const project = await readLocaleCatalogs(configFile, locale, "translate");
	if ("errors" in project) return project;
	const { base, target } = project;
	try {
		const units = exportUnits(base, target, locale, options.untranslated);
		const write = options.json ? writeUnitsJson : writeXliff;
		return { document: write(base.locale, locale, units), units: units.length };
	} catch (error) {
		if (!(error instanceof MessageProblem)) throw error;
		return {
			errors: [
				new GraiError(
					error.code,
					{ file: base.file, locale: base.locale },
					error.message,
				),
			],
		};
	}
}
