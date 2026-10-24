// grai's own compiler, from this repository's source, on an app's catalogs: a project under
// .cache with a copy of the catalogs, so benches may edit them.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./apps.mjs";

export const graiSource = new URL("../src/", import.meta.url).pathname;

/** Writes the project and returns its config file; the output goes to `out` beside it. */
export function writeGraiProject(app, name) {
	const directory = join(cacheDir, name, app.id);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(join(directory, "messages"), { recursive: true });
	for (const locale of app.locales)
		cpSync(app.catalogs[locale], join(directory, "messages", `${locale}.json`));
	const config = join(directory, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	return config;
}
