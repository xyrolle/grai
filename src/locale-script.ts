import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { minifySync, parseSync } from "vite";
import type { Config } from "./config.ts";
import { directionOf } from "./config-module.ts";
import { globPattern } from "./globs.ts";

/** A page's message chunks and their copies, `{locale}` standing for the page's locale. */
export type PageChunks = {
	/** The import map's entries: each directory of message chunks, and its copies' directory. */
	imports: Record<string, string>;
	/** The copies of the message chunks the page's entry imports. */
	preload: string[];
};

/**
 * The page's locale script (`runtime/page-locale.js`), as an inline classic script's text: the
 * function called with the project's settings and the server's language matching (`localeReach`
 * in `runtime/server.js`). It is the same for every page and every build of a project, so its hash
 * in a Content Security Policy stays valid until the config or grai changes; each page's chunks go
 * in its `data-grai-chunks`, which a hash does not cover.
 */
export function localeScript(config: Config, minify: boolean): string {
	const settings = {
		locales: config.locales,
		baseLocale: config.baseLocale,
		directions: config.locales.map(directionOf),
		strategy: config.strategy,
		cookieName: config.cookie?.name,
		localStorageKey: config.localStorageKey,
		queryParameter: config.queryParameter,
		prefixes: config.urlRouting.prefixes,
		prefixesEveryLocale: config.urlRouting.localePrefix === "always",
		unlocalizedPaths: config.urlRouting.unlocalizedPaths.map((glob) => {
			const { source, flags } = globPattern(glob);
			return { source, flags };
		}),
	};
	const call = `(${pickPageLocale})(${inlineJson(settings)}, ${localeReach});`;
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

const pickPageLocale = functionSource("page-locale.js", "pickPageLocale");
const localeReach = functionSource("server.js", "localeReach");

/** The source of a function declared at the top of a runtime module, exported or not. */
function functionSource(file: string, name: string): string {
	const text = readFileSync(
		new URL(`./runtime/${file}`, import.meta.url),
		"utf8",
	);
	for (const statement of parseSync(file, text).program.body) {
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
