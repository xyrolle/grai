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
	testingDeclarations,
} from "./runtime-declarations.ts";

/** The runtime's modules as the package has them, which every output carries. */
export type RuntimeSources = {
	runtime: string;
	server: string;
	testing: string;
};

/** formats.js as a render made it, and whether one of its formatters shows digits. */
export type RenderedFormats = {
	file: OutputFile | undefined;
	digits: boolean;
};

/**
 * The files of the modules the keys import, in one output: the runtime through its anchor,
 * `internal.js`, the plural rules and the formatters.
 */
export type OutputModules = {
	runtime: string;
	plurals: string;
	formats: string | undefined;
};

/**
 * The runtime's anchor: the one module of the output whose text changes with the runtime, which
 * every entry and module of the output reaches the runtime and its config through. A process reads
 * it once, so it holds one runtime, whichever compile's it read.
 */
const anchor = "internal.js";

/** The runtime's API: what `runtime.js` gives apps, and all of it. */
const runtimeApi = [
	"assertIsLocale",
	"baseLocale",
	"deLocalizeUrl",
	"extractLocaleFromUrl",
	"GraiError",
	"getLocale",
	"getTextDirection",
	"isLocale",
	"locales",
	"localizeHref",
	"localizeUrl",
	"setLocale",
];

/** The types of the runtime's API, which `runtime.d.ts` gives apps beside it. */
const runtimeApiTypes = ["Locale", "MarkupMessage", "Message", "MessagePart"];

/**
 * The modules beside the keys, each named by its content: the config, the runtime that reads it,
 * the plural rules, and the formatters when a message calls one. With them come the anchor,
 * `internal.js`, which re-exports the runtime, and with it what the rest of the output reads of the
 * config, and which an adapter takes what it binds from, and the entries apps import: `runtime.js`, the runtime's API alone, and `server.js`
 * and `testing.js`, whose imports name the anchor. They change only with grai, never with the
 * config. formats.js is the previous render's while no changed key calls other formatters.
 */
export function renderModules(
	config: Config,
	sources: RuntimeSources,
	compilation: Compilation,
	localeCopies: boolean,
	previous?: RenderedFormats,
): {
	modules: OutputModules;
	immutable: OutputFile[];
	entries: OutputFile[];
	formats: RenderedFormats;
} {
	const configCode = configModule(config, localeCopies);
	const configFile = `${contentName("config", configCode)}.js`;
	const runtimeCode = pinImports(
		sources.runtime,
		new Map([["./config.js", configFile]]),
	);
	const runtimeTypes = runtimeDeclarations(config);
	const runtime = contentName("runtime", runtimeCode, runtimeTypes);
	const rendered =
		previous !== undefined && !compilation.formatsChanged
			? previous
			: renderedFormats(compilation);
	const pluralsCode = pluralModule(config.locales, {
		digits: rendered.digits,
	});
	const plurals = `${contentName("plurals", pluralsCode)}.js`;
	const formats = rendered.file;
	const reexport = (file: string) => `export * from "./${file}";\n`;
	const api = (names: readonly string[]) =>
		`export {\n${names.map((name) => `\t${name},\n`).join("")}} from "./${anchor}";\n`;
	const anchored = new Map([
		["./config.js", anchor],
		["./runtime.js", anchor],
	]);
	return {
		formats: rendered,
		modules: { runtime: anchor, plurals, formats: formats?.[0] },
		immutable: [
			[configFile, configCode],
			[`${runtime}.js`, runtimeCode],
			[`${runtime}.d.ts`, runtimeTypes],
			[plurals, pluralsCode],
			...(formats === undefined ? [] : [formats]),
		],
		entries: [
			[anchor, reexport(`${runtime}.js`)],
			["internal.d.ts", reexport(`${runtime}.js`)],
			["runtime.js", api(runtimeApi)],
			[
				"runtime.d.ts",
				api([...runtimeApi, ...runtimeApiTypes.map((name) => `type ${name}`)]),
			],
			["server.js", pinImports(sources.server, anchored)],
			["server.d.ts", serverDeclarations],
			["testing.js", pinImports(sources.testing, anchored)],
			["testing.d.ts", testingDeclarations],
		],
	};
}

/**
 * formats.js from every formatted key's formatters, each written once: 18–21 ms of a recompile of
 * 13,000 formatted keys × 3, which a recompile in which no changed key calls other formatters
 * spares, as formats.js imports the runtime through its anchor, whose name never changes.
 */
function renderedFormats(compilation: Compilation): RenderedFormats {
	const formatters = usedFormatters(compilation);
	const code =
		formatters.length === 0 ? undefined : formatModule(formatters, anchor);
	return {
		file:
			code === undefined
				? undefined
				: [`${contentName("formats", code)}.js`, code],
		digits: formatters.some(({ shows }) => shows === "digits"),
	};
}

/** The formatters the messages call, for formats.js, from the keys that call one. */
function usedFormatters(compilation: Compilation): Formatter[] {
	return [...compilation.formatted].flatMap((key) => [
		...(compilation.keys.get(key)?.formats.values() ?? []),
	]);
}
