// Paraglide's own output for an app's catalogs: the baseline every bench compares against. It
// compiles offline, with the inlang plugins from this package's node_modules rather than a CDN,
// and keeps each output under .cache, keyed by the catalogs and the options.
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@inlang/paraglide-js";
import { cacheDir } from "./apps.mjs";

const installed = (path) =>
	new URL(`node_modules/${path}`, import.meta.url).pathname;
const { version } = JSON.parse(
	readFileSync(installed("@inlang/paraglide-js/package.json"), "utf8"),
);
const plugins = [
	"@inlang/plugin-message-format",
	"@inlang/plugin-m-function-matcher",
].map((name) => installed(`${name}/dist/index.js`));

/** The inlang project Paraglide reads: the app's catalogs in place, the plugins from disk. */
export function writeProject(app, directory) {
	const project = join(directory, "project.inlang");
	mkdirSync(project, { recursive: true });
	const settings = {
		baseLocale: app.baseLocale,
		locales: app.locales,
		modules: plugins,
		"plugin.inlang.messageFormat": {
			pathPattern: app.catalogs[app.baseLocale].replace(
				`${app.baseLocale}.json`,
				"{locale}.json",
			),
		},
	};
	writeFileSync(join(project, "settings.json"), JSON.stringify(settings));
	return project;
}

/**
 * Compiles the app's catalogs with Paraglide and returns the output directory. `options` are
 * Paraglide compiler options on top of the app's own (strategy, cookie name).
 */
export async function paraglideOutput(app, options = {}) {
	const compilerOptions = { ...app.compilerOptions, ...options };
	const hash = createHash("sha256")
		.update(version)
		.update(JSON.stringify(compilerOptions));
	for (const locale of app.locales)
		hash.update(readFileSync(app.catalogs[locale]));
	const directory = join(
		cacheDir,
		"paraglide",
		app.id,
		hash.digest("hex").slice(0, 12),
	);
	const outdir = join(directory, "out");
	if (existsSync(outdir)) return outdir;

	const staging = `${outdir}.partial`;
	rmSync(staging, { recursive: true, force: true });
	await compile({
		project: writeProject(app, directory),
		outdir: staging,
		emitGitIgnore: false,
		emitPrettierIgnore: false,
		emitReadme: false,
		...compilerOptions,
	});
	renameSync(staging, outdir);
	return outdir;
}

/**
 * Paraglide's output for a Vite build, as its docs set `isServer` up for Vite: Vite's own flag,
 * which a client build reads as false and a server build as true, so that each drops the other's
 * code.
 */
export const paraglideForVite = (app) =>
	paraglideOutput(app, { isServer: "import.meta.env.SSR" });

export const paraglideVersion = version;

/**
 * Paraglide's declaration emit needs TypeScript 6's API, which TypeScript 7 does not have. From
 * this call on, the process resolves `typescript` to the TypeScript 6 this package installs.
 */
export function resolveTypeScript6() {
	const url = pathToFileURL(
		createRequire(import.meta.url).resolve("typescript6"),
	).href;
	const hook = `export async function resolve(specifier, context, next) { return next(specifier === "typescript" ? ${JSON.stringify(url)} : specifier, context); }`;
	register(`data:text/javascript,${encodeURIComponent(hook)}`);
}
