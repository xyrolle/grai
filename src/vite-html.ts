import type {
	IndexHtmlTransformContext,
	ModulePreloadOptions,
	Rolldown,
} from "vite";
import type { Config } from "./config.ts";
import { besideDirectory, messageOnly } from "./locale-chunks.ts";
import { localeScript, type PageChunks } from "./locale-script.ts";
import { isMessageChunk, localeDirectory } from "./message-directories.ts";

/**
 * The client build's module preloads, without a page's own preloads of message chunks: those
 * hold every locale's words, and the page's locale script preloads its locale's copies instead. A
 * dynamic import's preloads keep them, as Vite resolves those through the page's import map. An
 * app's own `resolveDependencies` still decides first.
 */
export function pagePreloads(
	modulePreload: boolean | ModulePreloadOptions | undefined,
): ModulePreloadOptions | undefined {
	if (modulePreload === false) return undefined;
	const resolve =
		typeof modulePreload === "object"
			? modulePreload.resolveDependencies
			: undefined;
	return {
		resolveDependencies(file, dependencies, context) {
			const resolved = resolve?.(file, dependencies, context) ?? dependencies;
			return context.hostType === "html"
				? resolved.filter((dependency) => !isMessageChunk(dependency))
				: resolved;
		},
	};
}

/** What a page's locale script takes from Vite's config. */
export type Site = {
	base: string;
	/** Whether the build preloads a page's modules, `build.modulePreload`. */
	preloads: boolean;
	/** Whether the build writes each message chunk's copies, one per locale: `localeChunks`. */
	copies: boolean;
};

/**
 * A page with its locale script, and in a build that copies the message chunks per locale, the
 * page's chunks for it. A build minifies the script; dev serves it as written.
 */
export function withPageLocale(
	html: string,
	context: IndexHtmlTransformContext,
	config: Config,
	site: Site,
): string {
	const script = localeScript(config, context.bundle !== undefined);
	const chunks =
		context.bundle === undefined
			? undefined
			: pageChunks(context.bundle, context.chunk, context.path.slice(1), site);
	return withLocaleScript(html, script, chunks);
}

/** The first module script or module preload of a page, which the locale script goes ahead of. */
const firstModule =
	/<script\b[^>]*\btype=["']?module\b|<link\b[^>]*\brel=["']?modulepreload\b/i;
const headEnd = /<\/head>/i;

/**
 * A page with its locale script ahead of every module script and module preload, and after the
 * tags before them, such as `<meta charset>`, which must come within the page's first 1024 bytes.
 * A page's chunks, in a build that copies them per locale, go in the script's `data-grai-chunks`.
 */
function withLocaleScript(
	html: string,
	script: string,
	chunks: PageChunks | undefined,
): string {
	const data =
		chunks === undefined ? "" : ` data-grai-chunks="${attribute(chunks)}"`;
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

/** JSON as an HTML attribute's double-quoted value. */
function attribute(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;");
}
