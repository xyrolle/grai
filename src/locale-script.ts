import { readFileSync } from "node:fs";
import { minifySync, parseSync } from "vite";
import type { Config } from "./config.ts";
import { directionOf } from "./config-module.ts";
import { globPattern } from "./globs.ts";

/**
 * The page's locale script (`runtime/page-locale.js`), as an inline classic script's text: the
 * function called with the project's settings and the server's language matching (`localeReach`
 * in `runtime/server.js`), the same for every page.
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
