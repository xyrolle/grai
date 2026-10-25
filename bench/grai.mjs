// grai's own compiler, from this repository's source, on an app's catalogs: a project under
// .cache with a copy of the catalogs, so benches may edit them, and the app's strategy, so that
// grai's middleware resolves a request's locale as the app's server does.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "./apps.mjs";

export const graiSource = new URL("../src/", import.meta.url).pathname;

/** The strategies grai has; an app's custom ones are left out, and the base locale is grai's last resort. */
const strategies = new Set(["cookie", "preferredLanguage", "url"]);

/** Writes the project and returns its config file; the output goes to `out` beside it. */
export function writeGraiProject(app, name) {
	const directory = join(cacheDir, name, app.id);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(join(directory, "messages"), { recursive: true });
	for (const locale of app.locales)
		cpSync(app.catalogs[locale], join(directory, "messages", `${locale}.json`));
	const { strategy, cookieName } = app.compilerOptions;
	const used = strategy.filter((source) => strategies.has(source));
	const config = join(directory, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "out",
			strategy: used,
			...(used.includes("cookie") && { cookieName }),
		}),
	);
	return config;
}

const compiled = new Map();

/** grai's output for an app, compiled once a process: its config file and its directory. */
export function graiOutput(app) {
	if (!compiled.has(app.id)) compiled.set(app.id, compileOutput(app));
	return compiled.get(app.id);
}

async function compileOutput(app) {
	const config = writeGraiProject(app, "grai-output");
	const { compile } = await import(join(graiSource, "index.ts"));
	const { errors } = await compile(config);
	if (errors.length > 0)
		throw new Error(errors.map((error) => error.message).join("\n"));
	return { config, outdir: join(dirname(config), "out") };
}
