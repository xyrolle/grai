import type { Compilation } from "./compilation.ts";
import type { Config } from "./config.ts";
import { contentName, pinImports } from "./content-names.ts";
import { runtimeDeclarations, serverDeclarations } from "./declarations.ts";
import { formatModule } from "./formatters.ts";
import { pluralModule } from "./plurals.ts";
import type { OutputFile } from "./render.ts";

/** The runtime's modules as the package has them, which every output carries. */
export type RuntimeSources = { runtime: string; server: string };

/** The files of the modules the keys import, in one output: the runtime, plurals and formats. */
export type OutputModules = {
	runtime: string;
	plurals: string;
	formats: string | undefined;
};

/**
 * The modules beside the keys, each named by its content: the config, the runtime that reads it,
 * the plural rules, and the formatters when a message calls one. With them come the entries apps
 * import instead: `runtime.js` and `config.js`, which re-export this output's modules, and
 * `server.js`, the middleware with its imports pinned to them.
 */
export function renderModules(
	config: Config,
	sources: RuntimeSources,
	compilation: Compilation,
): {
	modules: OutputModules;
	immutable: OutputFile[];
	entries: OutputFile[];
} {
	const configCode = configModule(config);
	const configFile = `${contentName("config", configCode)}.js`;
	const runtimeCode = pinImports(
		sources.runtime,
		new Map([["./config.js", configFile]]),
	);
	const runtimeTypes = runtimeDeclarations(config);
	const runtime = contentName("runtime", runtimeCode, runtimeTypes);
	const pluralsCode = pluralModule(config.locales);
	const plurals = `${contentName("plurals", pluralsCode)}.js`;
	const formatsCode = formatsOf(compilation, `${runtime}.js`);
	const formats: OutputFile | undefined =
		formatsCode === undefined
			? undefined
			: [`${contentName("formats", formatsCode)}.js`, formatsCode];
	const reexport = (file: string) => `export * from "./${file}";\n`;
	const server = pinImports(
		sources.server,
		new Map([
			["./config.js", configFile],
			["./runtime.js", `${runtime}.js`],
		]),
	);
	return {
		modules: { runtime: `${runtime}.js`, plurals, formats: formats?.[0] },
		immutable: [
			[configFile, configCode],
			[`${runtime}.js`, runtimeCode],
			[`${runtime}.d.ts`, runtimeTypes],
			[plurals, pluralsCode],
			...(formats === undefined ? [] : [formats]),
		],
		entries: [
			["config.js", reexport(configFile)],
			["runtime.js", reexport(`${runtime}.js`)],
			["runtime.d.ts", reexport(`${runtime}.js`)],
			["server.js", server],
			["server.d.ts", serverDeclarations],
		],
	};
}

/** formats.js's code, when a message calls a formatter. */
function formatsOf(
	compilation: Compilation,
	runtime: string,
): string | undefined {
	if (compilation.formatted.size === 0) return undefined;
	const formatters = [...compilation.formatted].flatMap((key) => [
		...(compilation.keys.get(key)?.formats.values() ?? []),
	]);
	return formatModule(formatters, runtime);
}

/** config.js: the project's config, as the runtime reads it. */
function configModule(config: Config): string {
	return [
		`export const locales = ${JSON.stringify(config.locales)};`,
		`export const baseLocale = ${JSON.stringify(config.baseLocale)};`,
		`/** @type {readonly ("ltr" | "rtl")[]} */`,
		`export const directions = ${JSON.stringify(config.locales.map(directionOf))};`,
		`/** @type {readonly ("cookie" | "preferredLanguage" | "url")[]} */`,
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		"/** @type {string | undefined} */",
		`export const cookieName = ${config.cookieName === undefined ? "undefined" : JSON.stringify(config.cookieName)};`,
		"",
	].join("\n");
}

/** Scripts written right to left. */
const rightToLeft = new Set([
	"Adlm",
	"Arab",
	"Hebr",
	"Mand",
	"Nkoo",
	"Rohg",
	"Samr",
	"Syrc",
	"Thaa",
	"Yezi",
]);

/** The direction a locale's script is written in, from its likely script. */
function directionOf(locale: string): "ltr" | "rtl" {
	const script = new Intl.Locale(locale).maximize().script;
	return script !== undefined && rightToLeft.has(script) ? "rtl" : "ltr";
}
