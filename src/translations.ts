/**
 * `grai export` and `grai merge`: a locale's messages out to translators, and their translations
 * back into its catalog, as XLIFF 2.0 or as JSON for scripts.
 */

import { readFileSync } from "node:fs";
import { dirname, extname, relative } from "node:path";
import { fileIndexOf } from "./catalog.ts";
import { catalogsWithMessages } from "./catalog-file.ts";
import { type CompileResult, compile } from "./compile.ts";
import { readDescriptions } from "./descriptions.ts";
import { GraiError } from "./error.ts";
import { readLocaleCatalogs } from "./locale-catalogs.ts";
import { MessageProblem } from "./problem.ts";
import type { ReturnedUnit } from "./returned-units.ts";
import { readUnitsJson, writeUnitsJson } from "./translation-json.ts";
import { mergeUnits } from "./translation-merge.ts";
import { exportUnits } from "./translation-units.ts";
import { writeAll } from "./write-all.ts";
import { readXliff } from "./xliff-reader.ts";
import { writeXliff } from "./xliff-writer.ts";
import { XmlError } from "./xml-reader.ts";

/** A locale's units as a document: XLIFF 2.0, or JSON. Only the untranslated ones when asked. */
export async function exportLocale(
	configFile: string,
	locale: string,
	options: { json: boolean; untranslated: boolean },
): Promise<{ document: string; units: number } | { errors: GraiError[] }> {
	const project = await readLocaleCatalogs(configFile, locale, "translate");
	if ("errors" in project) return project;
	const { config, base, target, identical, inherited } = project;
	try {
		const units = exportUnits(
			base,
			target,
			locale,
			identical,
			inherited,
			options.untranslated,
		);
		const write = options.json ? writeUnitsJson : writeXliff;
		const descriptions = readDescriptions(config);
		return {
			document: write(base.locale, locale, units, descriptions),
			units: units.length,
		};
	} catch (error) {
		if (error instanceof GraiError) return { errors: [error] };
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

/**
 * What a merge wrote into the locale's catalog: the files it changed messages of, or all of them
 * when it changed none, and the units it took. And what it refused.
 */
export type MergeResult = {
	files: string[];
	messages: number;
	units: number;
	refused: GraiError[];
	result: CompileResult;
};

/**
 * Merges a document of translated units into its target locale's catalog, then compiles. A unit
 * that is stale or invalid is refused and named; the rest is written, in one write.
 */
export async function mergeDocument(
	configFile: string,
	documentFile: string,
): Promise<MergeResult | { errors: GraiError[] }> {
	// Named from the project's root, as every other file in an error is.
	const file = relative(dirname(configFile), documentFile);
	let document: { srcLang: string; trgLang: string; units: ReturnedUnit[] };
	try {
		const text = readFileSync(documentFile, "utf8");
		document =
			extname(documentFile) === ".json" ? readUnitsJson(text) : readXliff(text);
	} catch (error) {
		if (!(error instanceof Error) || error instanceof TypeError) throw error;
		const reason =
			error instanceof XmlError || error instanceof SyntaxError
				? `it cannot be read, ${error.message}`
				: error.message;
		return { errors: [new GraiError("translation-invalid", { file }, reason)] };
	}
	const project = await readLocaleCatalogs(
		configFile,
		document.trgLang,
		"translate",
	);
	if ("errors" in project) return project;
	const { config, paths, base, target, identical, inherited } = project;
	if (document.srcLang !== base.locale) {
		const detail = `its source language is ${document.srcLang}, and the base locale is ${base.locale}.`;
		return { errors: [new GraiError("translation-invalid", { file }, detail)] };
	}
	const merged = mergeUnits(
		base,
		target,
		document.trgLang,
		identical,
		inherited,
		document.units,
	);
	// A message goes back to the file the locale has its key in, or else the base's place for it.
	const texts = catalogsWithMessages(
		paths,
		merged.messages.map(([key, value]) =>
			target?.messages.has(key)
				? [target.paths.get(key) ?? [key], value, fileIndexOf(target, key)]
				: [base.paths.get(key) ?? [key], value, fileIndexOf(base, key)],
		),
		(config.catalogs.get(base.locale) ?? paths)[0],
	);
	writeAll(texts);
	const written = texts.size > 0 ? [...texts.keys()] : paths;
	return {
		files: written.map((path) => relative(config.root, path)),
		messages: merged.messages.length,
		units: merged.units,
		refused: merged.refused.map(
			(refusal) =>
				new GraiError(
					refusal.code,
					{ file, key: refusal.key, locale: document.trgLang },
					refusal.unit === undefined
						? refusal.detail
						: `unit ${refusal.unit}: ${refusal.detail}`,
				),
		),
		result: await compile(configFile),
	};
}
