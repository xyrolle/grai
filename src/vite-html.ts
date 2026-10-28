import type { IndexHtmlTransformContext, Logger, Plugin, Rolldown } from "vite";
import type { Config } from "./config.ts";
import { besideDirectory, messageOnly } from "./locale-chunks.ts";
import {
	cspHash,
	importMapText,
	localeScript,
	type PageChunks,
} from "./locale-script.ts";
import { localeDirectory } from "./message-directories.ts";
import type { GraiOptions, GraiPlugin } from "./vite-plugin.ts";

/**
 * The locale script's plugin, for an app whose pages Vite serves from its index.html files, as a
 * plain Vite app's and a Svelte app's are: each page it builds or serves gets the script. A framework
 * that draws its own pages never runs Vite's `transformIndexHtml` hook, and SvelteKit warns of a
 * plugin that has one, so its adapter leaves this plugin out, and with it the script's code.
 */
export function pageLocale(core: GraiPlugin, options: GraiOptions): Plugin {
	let site: Site = { base: "/", preloads: true, copies: false };
	let logger: Logger | undefined;
	/** The hashes the build's log has named, each once. */
	const reported = new Set<string>();
	return {
		name: "grai:page-locale",
		configResolved(resolved) {
			site = {
				base: resolved.base,
				preloads: resolved.build.modulePreload !== false,
				copies: options.localeChunks === true,
			};
			logger = resolved.logger;
		},
		transformIndexHtml: {
			// After Vite has written the page's module scripts and preloads, which it goes ahead of.
			order: "post",
			handler(html, context) {
				const page = withPageLocale(html, context, core.config(), site);
				const unreported = page.hashes.filter((hash) => !reported.has(hash));
				if (context.bundle !== undefined && unreported.length > 0) {
					for (const hash of unreported) reported.add(hash);
					logger?.info(
						`grai: a Content Security Policy that allows scripts by hash needs ${unreported.join(" ")} in script-src, for the locale script and its import maps.`,
					);
				}
				return page.html;
			},
		},
	};
}

/** What a page's locale script takes from Vite's config. */
type Site = {
	base: string;
	/** Whether the build preloads a page's modules, `build.modulePreload`. */
	preloads: boolean;
	/** Whether the build writes each message chunk's copies, one per locale: `localeChunks`. */
	copies: boolean;
};

/**
 * A page with its locale script, and the Content Security Policy hashes of what the script runs
 * and writes: itself, and in a build that copies the message chunks per locale, each locale's
 * import map. A build minifies the script; dev serves it as written.
 */
function withPageLocale(
	html: string,
	context: IndexHtmlTransformContext,
	config: Config,
	site: Site,
): { html: string; hashes: string[] } {
	const built = context.bundle !== undefined;
	const script = localeScript(config, {
		minify: built,
		copies: built && site.copies,
	});
	const chunks =
		context.bundle === undefined
			? undefined
			: pageChunks(context.bundle, context.chunk, context.path.slice(1), site);
	const maps =
		chunks === undefined
			? []
			: config.locales.map((locale) => importMapText(chunks, locale));
	return {
		html: withLocaleScript(html, script, chunks),
		hashes: [script, ...maps].map(cspHash),
	};
}

/** The first module script or module preload of a page, which the locale script goes ahead of. */
const firstModule =
	/<script\b[^>]*\btype=["']?module\b|<link\b[^>]*\brel=["']?modulepreload\b/i;
const headEnd = /<\/head>/i;
/** The `lang` of a page's `<html>`, quoted or not. */
const htmlLang =
	/<html\b[^>]*?\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/**
 * A page with its locale script ahead of every module script and module preload, and after the
 * tags before them, such as `<meta charset>`, which must come within the page's first 1024 bytes.
 * The `<html lang>` the page is built with goes in the script's `data-grai-lang`, for the script to
 * tell it from one a server writes in its place, and a page's chunks, in a build that copies them
 * per locale, in its `data-grai-chunks`.
 */
function withLocaleScript(
	html: string,
	script: string,
	chunks: PageChunks | undefined,
): string {
	const lang = html
		.match(htmlLang)
		?.slice(1)
		.find((value) => value !== undefined);
	const data =
		(lang === undefined ? "" : ` data-grai-lang="${attribute(lang)}"`) +
		(chunks === undefined
			? ""
			: ` data-grai-chunks="${attribute(JSON.stringify(chunks))}"`);
	const tag = `<script${data}>${script}</script>\n`;
	const at = html.search(firstModule);
	if (at !== -1) return html.slice(0, at) + tag + html.slice(at);
	const end = html.search(headEnd);
	return end === -1 ? tag + html : html.slice(0, end) + tag + html.slice(end);
}

/**
 * A built page's chunks: an import map entry for each directory of message chunks, and the copies
 * of the message chunks its entry imports, as the page writes their URLs. None when the build
 * writes no copies of them (`localeChunks`), or has no message chunks of their own.
 */
function pageChunks(
	bundle: Rolldown.OutputBundle,
	entry: Rolldown.OutputChunk | undefined,
	page: string,
	{ base, preloads, copies }: Site,
): PageChunks | undefined {
	if (!copies) return undefined;
	const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
	const messages = chunks.filter((chunk) => messageOnly(chunk.moduleIds));
	if (messages.length === 0) return undefined;
	const files = filesBase(page, base);
	const copy = (file: string) =>
		besideDirectory(file, localeDirectory("{locale}"));
	const imports = Object.fromEntries(
		messages.map(({ fileName }) => [
			files + directoryOf(fileName),
			files + directoryOf(copy(fileName)),
		]),
	);
	const isMessage = new Set(messages.map((chunk) => chunk.fileName));
	const imported =
		entry === undefined || !preloads ? [] : importedBy(entry, chunks);
	const preload = imported
		.filter((file) => isMessage.has(file))
		.map((file) => files + copy(file));
	return { imports, preload };
}

/**
 * Where a page's built files start, as Vite writes them: `base`, or with a relative base (`./` or
 * an empty one), the way back from the page's own directory.
 */
function filesBase(page: string, base: string): string {
	if (base !== "./" && base !== "") return base;
	const depth = page.split("/").length - 1;
	return depth === 0 ? "./" : "../".repeat(depth);
}

/** Every chunk an entry imports statically, directly or through another, as Vite preloads them. */
function importedBy(
	entry: Rolldown.OutputChunk,
	chunks: readonly Rolldown.OutputChunk[],
): string[] {
	const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const seen = new Set<string>();
	const visit = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const imported of byFile.get(file)?.imports ?? []) visit(imported);
	};
	for (const imported of entry.imports) visit(imported);
	return [...seen];
}

function directoryOf(fileName: string): string {
	return fileName.slice(0, fileName.lastIndexOf("/") + 1);
}

/** Text as an HTML attribute's double-quoted value. */
function attribute(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
