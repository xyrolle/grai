import type { IndexHtmlTransformContext } from "vite";
import type { Config } from "./config.ts";
import { localeScript } from "./locale-script.ts";

/** A page with its locale script. A build minifies the script; dev serves it as written. */
export function withPageLocale(
	html: string,
	context: IndexHtmlTransformContext,
	config: Config,
): string {
	const script = localeScript(config, context.bundle !== undefined);
	return withLocaleScript(html, script);
}

/** The first module script or module preload of a page, which the locale script goes ahead of. */
const firstModule =
	/<script\b[^>]*\btype=["']?module\b|<link\b[^>]*\brel=["']?modulepreload\b/i;
const headEnd = /<\/head>/i;

/**
 * A page with its locale script ahead of every module script and module preload, and after the
 * tags before them, such as `<meta charset>`, which must come within the page's first 1024 bytes.
 */
function withLocaleScript(html: string, script: string): string {
	const tag = `<script>${script}</script>\n`;
	const at = html.search(firstModule);
	if (at !== -1) return html.slice(0, at) + tag + html.slice(at);
	const end = html.search(headEnd);
	return end === -1 ? tag + html : html.slice(0, end) + tag + html.slice(end);
}
