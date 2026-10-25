import { existsSync, mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { KeyPath } from "../catalog-keys.ts";
import { tabbedLayout } from "../catalog-layout.ts";
import { withMessages } from "../catalog-text.ts";
import type { Config } from "../config.ts";
import type { Descriptions } from "../descriptions.ts";
import { GraiError } from "../error.ts";
import { writeAll } from "../write-all.ts";
import type { CatalogFile } from "./catalogs.ts";

/** An error for each catalog that exists already: an import writes new catalogs only, so it never overwrites edits. */
export function existingCatalogs(
	files: readonly CatalogFile[],
	root: string,
): GraiError[] {
	return files
		.filter(({ path }) => existsSync(path))
		.map(
			({ locale, path }) =>
				new GraiError(
					"catalog-exists",
					{ file: relative(root, path), locale },
					"the catalog exists already, and import writes new catalogs only. Move it away, or point catalogs elsewhere in the config.",
				),
		);
}

/**
 * Why the sources' descriptions cannot be kept: the config names no file for them, or the file
 * exists already, which an import never overwrites.
 */
export function unkeptDescriptions(
	descriptions: Descriptions,
	config: Config,
	configFile: string,
): GraiError[] {
	if (descriptions.size === 0) return [];
	const file = config.descriptions;
	if (file === undefined) {
		const count = `${descriptions.size} ${descriptions.size === 1 ? "message" : "messages"}`;
		return [
			new GraiError(
				"config-invalid",
				{ file: relative(config.root, configFile) },
				`the sources describe ${count} for translators, which grai keeps in the file the config's "descriptions" names. Add "descriptions": "messages/descriptions.json" to the config, and import again.`,
			),
		];
	}
	if (!existsSync(file)) return [];
	return [
		new GraiError(
			"catalog-exists",
			{ file: relative(config.root, file) },
			"the descriptions file exists already, and import writes new files only. Move it away, or point descriptions elsewhere in the config.",
		),
	];
}

/**
 * Writes every catalog, an entry per line indented by a tab, and the other files, or none of
 * them; returns the catalogs, relative to the root.
 */
export function writeCatalogs(
	files: readonly CatalogFile[],
	others: ReadonlyMap<string, string>,
	root: string,
): string[] {
	const texts = new Map(others);
	for (const path of others.keys())
		mkdirSync(dirname(path), { recursive: true });
	for (const { path, catalog } of files) {
		mkdirSync(dirname(path), { recursive: true });
		texts.set(
			path,
			withMessages(
				"{}\n",
				[...catalog].map(([key, value]): [KeyPath, unknown] => [[key], value]),
				tabbedLayout,
			),
		);
	}
	writeAll(texts);
	return files.map(({ path }) => relative(root, path));
}
