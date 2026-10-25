import type { Compilation } from "./compilation.ts";
import type { Config } from "./config.ts";
import { configModule } from "./config-module.ts";
import { contentName, pinImports } from "./content-names.ts";
import { type Formatter, formatModule } from "./formatters.ts";
import { pluralModule } from "./plurals.ts";
import type { OutputFile } from "./render.ts";
import {
	runtimeDeclarations,
	serverDeclarations,
} from "./runtime-declarations.ts";

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
	localeCopies: boolean,
): {
	modules: OutputModules;
	immutable: OutputFile[];
	entries: OutputFile[];
} {
	const configCode = configModule(config, localeCopies);
	const configFile = `${contentName("config", configCode)}.js`;
	const runtimeCode = pinImports(
		sources.runtime,
		new Map([["./config.js", configFile]]),
	);
	const runtimeTypes = runtimeDeclarations(config);
	const runtime = contentName("runtime", runtimeCode, runtimeTypes);
	const formatters = usedFormatters(compilation);
	const pluralsCode = pluralModule(config.locales, {
		digits: formatters.some(({ shows }) => shows === "digits"),
	});
	const plurals = `${contentName("plurals", pluralsCode)}.js`;
	const formatsCode =
		formatters.length === 0
			? undefined
			: formatModule(formatters, `${runtime}.js`);
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

/** The formatters the messages call, for formats.js, from the keys that call one. */
function usedFormatters(compilation: Compilation): Formatter[] {
	return [...compilation.formatted].flatMap((key) => [
		...(compilation.keys.get(key)?.formats.values() ?? []),
	]);
}
