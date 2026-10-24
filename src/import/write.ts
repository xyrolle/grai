import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { GraiError } from "../error.ts";
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

/** Writes each catalog through a temporary file renamed into place; returns the files, relative to the root. */
export function writeCatalogs(
	files: readonly CatalogFile[],
	root: string,
): string[] {
	return files.map(({ path, catalog }) => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(`${path}.tmp`, `${JSON.stringify(catalog, null, "\t")}\n`);
		renameSync(`${path}.tmp`, path);
		return relative(root, path);
	});
}
