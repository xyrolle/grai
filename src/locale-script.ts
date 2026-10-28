import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { minifySync } from "vite";
import type { Config } from "./config.ts";
import { directionOf } from "./config-module.ts";
import { globPattern } from "./globs.ts";
import { packageFile } from "./package-files.ts";

/** A page's message chunks and their copies, `{locale}` standing for the page's locale. */
export type PageChunks = {
	/** The import map's entries: each directory of message chunks, and its copies' directory. */
	imports: Record<string, string>;
	/** The copies of the message chunks the page's entry imports. */
	preload: string[];
};

/**
 * The page's locale script (`runtime/page-locale.js`), as an inline classic script's text:
 * `pickPageLocale` called with the project's settings and a reader of each place the config's
 * strategy reads in a page, in its order, then, with `copies`, `pointAtCopies`. A page holds the
 * code of those places alone, and the server's language matching (`localeReach` in
 * `runtime/server.js`) only where a place matches a language. It is the same for every page and
 * every build of a project, so its hash in a Content Security Policy stays valid until the config
 * or grai changes; each page's chunks go in its `data-grai-chunks`, which a hash does not cover.
 */
export async function localeScript(
	config: Config,
	{ minify, copies }: { minify: boolean; copies: boolean },
): Promise<string> {
	const read = config.strategy.flatMap((source) => places.get(source) ?? []);
	const settings = Object.assign(
		{
			locales: config.locales,
			baseLocale: config.baseLocale,
			directions: config.locales.map(directionOf),
		},
		...read.map((place) => place.settings(config)),
	);
	const matches = read.some((place) => place.matches);
	const page = await pageFunctions();
	// V8 gives a function's source as it stands in its module, so no parser reads page-locale.js.
	const sourceOf = (name: PageFunction) => page[name].toString();
	const readers = read.map(
		(place) =>
			`(${sourceOf(place.reader)})(settings${place.matches ? ", localeReach" : ""})`,
	);
	const steps = [
		`(${sourceOf("pickPageLocale")})(settings, [${readers.join(", ")}]);`,
		...(copies ? [`(${sourceOf("pointAtCopies")})();`] : []),
	];
	const parameters = matches ? "settings, localeReach" : "settings";
	const values = matches
		? `${inlineJson(settings)}, ${await localeReach()}`
		: inlineJson(settings);
	const call = `((${parameters}) => {\n${steps.join("\n")}\n})(${values});`;
	return minify ? minifySync("grai-page-locale.js", call).code : call;
}

/** The import map a page's locale script writes for a locale, as the script writes it. */
export function importMapText(chunks: PageChunks, locale: string): string {
	const copies = JSON.stringify(chunks).replaceAll("{locale}", locale);
	const { imports }: PageChunks = JSON.parse(copies);
	return JSON.stringify({ imports });
}

/** A script's hash, as a Content Security Policy's `script-src` allows it. */
export function cspHash(text: string): string {
	return `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
}

/** JSON that can stand in a `<script>`: no `</script>` or `<!--` ends or comments it. */
function inlineJson(value: unknown): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** A function of `runtime/page-locale.js` that a page's script holds. */
type PageFunction =
	| "pickPageLocale"
	| "pointAtCopies"
	| "cookieReader"
	| "storageReader"
	| "queryReader"
	| "languagesReader"
	| "pathReader";

/**
 * `runtime/page-locale.js`, imported the first time a script is written. It is the runtime's plain
 * JavaScript, which type-checking the runtime checks, so it is imported by its URL, with no
 * declarations of its own beside it.
 */
let pageLocale: Promise<Record<PageFunction, () => unknown>> | undefined;
function pageFunctions(): Promise<Record<PageFunction, () => unknown>> {
	pageLocale ??= import(packageFile("runtime/page-locale.js").href);
	return pageLocale;
}

/**
 * The server's language matching, `localeReach` in `runtime/server.js`, read from that module the
 * first time a page's strategy matches a language. It is the one function of the script that is
 * not page-locale.js's, and server.js imports the output's config, so it is found by parsing the
 * module, and the parser loads only for a script that holds it.
 */
let localeReachSource: Promise<string> | undefined;
function localeReach(): Promise<string> {
	localeReachSource ??= functionSource("server.js", "localeReach");
	return localeReachSource;
}

/**
 * A place a page reads for a strategy: the function that makes its reader, what it reads of the
 * config, and whether it matches a language as the server does.
 */
type Place = {
	reader: PageFunction;
	settings: (config: Config) => Record<string, unknown>;
	matches: boolean;
};

/** The place each strategy reads in a page; a `custom-` one has none. */
const places = new Map<string, Place>([
	[
		"cookie",
		{
			reader: "cookieReader",
			settings: (config) => ({ cookieName: config.cookie?.name }),
			matches: false,
		},
	],
	[
		"localStorage",
		{
			reader: "storageReader",
			settings: (config) => ({ localStorageKey: config.localStorageKey }),
			matches: false,
		},
	],
	[
		"query",
		{
			reader: "queryReader",
			settings: (config) => ({ queryParameter: config.queryParameter }),
			matches: true,
		},
	],
	[
		"preferredLanguage",
		{
			reader: "languagesReader",
			settings: () => ({}),
			matches: true,
		},
	],
	[
		"url",
		{
			reader: "pathReader",
			settings: ({ urlRouting }) => ({
				prefixes: urlRouting.prefixes,
				prefixesEveryLocale: urlRouting.localePrefix === "always",
				basePath: urlRouting.basePath,
				domains: urlRouting.domains,
				unlocalizedPaths: urlRouting.unlocalizedPaths.map((glob) => {
					const { source, flags } = globPattern(glob);
					return { source, flags };
				}),
			}),
			matches: false,
		},
	],
]);

/** The source of a function declared at the top of a runtime module, exported or not. */
async function functionSource(file: string, name: string): Promise<string> {
	const { parse } = await import("./code/parse.ts");
	const text = readFileSync(packageFile(`runtime/${file}`), "utf8");
	for (const statement of parse(file, text).program.body) {
		const declaration =
			statement.type === "ExportNamedDeclaration"
				? statement.declaration
				: statement;
		if (
			declaration?.type === "FunctionDeclaration" &&
			declaration.id?.name === name
		) {
			return text.slice(declaration.start, declaration.end);
		}
	}
	throw new Error(`grai: runtime/${file} declares no function ${name}.`);
}
