import { existsSync, mkdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { KeyPath } from "../catalog-keys.ts";
import { tabbedLayout } from "../catalog-layout.ts";
import { withMessages } from "../catalog-text.ts";
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

/** Writes every catalog or none, an entry per line indented by a tab; returns the files, relative to the root. */
export function writeCatalogs(
	files: readonly CatalogFile[],
	root: string,
): string[] {
	const texts = new Map<string, string>();
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
