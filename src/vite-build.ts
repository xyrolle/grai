import { minifySync, type Rolldown } from "vite";
import type { Build } from "./compile.ts";
import { GraiError, sortErrors } from "./error.ts";
import { fallbackPositions, messageSource } from "./fallbacks.ts";
import { keyExports } from "./key-exports.ts";
import { type KeyLinks, keyReach, type ModuleGraph } from "./key-reach.ts";
import { pageChunks } from "./key-sets.ts";
import {
	besideDirectory,
	inDirectory,
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	messageOnly,
	outputPrefix,
	textModulePrefix,
} from "./locale-chunks.ts";
import { localeCopies } from "./locale-copies.ts";
import { localeDirectory, messageDirectory } from "./message-directories.ts";
import { runtimeKindIn } from "./module-kinds.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";

/** keys.js in a build: each key from its own module, so a chunk holds only the keys its code uses. */
export function keysModule(build: Build): string {
	return [...build.compilation.keys.keys()]
		.map((key) => `export { ${key} } from "${keyPrefix}${key}";`)
		.join("\n");
}

/** An output file as a build's key and text modules import it. */
const outputModule = (file: string) => `${outputPrefix}${file}`;

/**
 * A key's module in a build, from the compiler's model, or nothing for an id that is no key's: the
 * key's value for the browser, or for a server, exported under the key.
 */
export function keyModule(
	build: Build,
	id: string,
	consumer: "client" | "server",
): string | undefined {
	const name = id.slice(keyModulePrefix.length);
	const key = build.compilation.keys.get(name);
	if (key === undefined) return undefined;
	const server = consumer === "server";
	const names = calledNames([key], server ? key.serverUses : key.uses);
	const value = server ? key.serverValue : key.value;
	return `${outputImports(names, outputModule, build.rendered.modules)}\n${keyExports([{ name, value }], everyName(names))}`;
}

/**
 * A text key's string module. In a client build, its text in the page's locale, chosen once; its
 * variants are the key's, so each locale's copy of its chunk keeps only that locale's words. On a
 * server, an object whose `text` calls the key, in the request's locale, each time it is read.
 */
export function textModule(
	build: Build,
	id: string,
	consumer: "client" | "server",
): string | undefined {
	const name = id.slice(textModulePrefix.length);
	const key = build.compilation.keys.get(name);
	if (key?.kind !== "text") return undefined;
	if (consumer === "server") {
		const message = `grai_${name}`;
		return `import { ${name} as ${message} } from "${keyPrefix}${name}";\nexport const ${name} = { get text() { return ${message}(); } };\n`;
	}
	const names = calledNames([key], ["pageText"]);
	const value = `/*#__PURE__*/ pageText(${key.variants.join(", ")})`;
	return `${outputImports(names, outputModule, build.rendered.modules)}\n${keyExports([{ name, value }], everyName(names))}`;
}

/**
 * The chunk of each key and text module of `build`, by the pages that load it (`pageChunks`): its
 * reach read from the module graph as `links` amends it (`keyReach`).
 */
export function keyPageChunks(
	build: Build,
	keysFile: string,
	graph: ModuleGraph,
	links: KeyLinks,
	pages: readonly (readonly string[])[] | undefined,
): Map<string, string> {
	const { keys } = build.compilation;
	const locales = build.config.locales.length;
	const keyOf = (id: string) => id.slice(id.indexOf("/") + 1);
	const bytesOf = (id: string) => {
		const key = keys.get(keyOf(id));
		const code = [...(key?.variants ?? []), ...(key?.parts ?? [])];
		return code.reduce((total, part) => total + part.length, 0) / locales;
	};
	const ids = [...keys.keys()].flatMap((key) => [
		`${keyModulePrefix}${key}`,
		`${textModulePrefix}${key}`,
	]);
	return pageChunks(keyReach(graph, ids, keysFile, links), bytesOf, pages);
}

/** The bundler's chunking context, as much as grai's chunking reads of it. */
export type ChunkingGraph = { getModuleInfo: ModuleGraph };

/**
 * The client build's groups of messages. The runtime has a chunk of its own, so a message chunk
 * holds keys and nothing else, and each key goes in the chunk `pageChunkOf` names, by the pages
 * that load it.
 */
export function messageGroups(
	outdir: string,
	pageChunkOf: (id: string, graph: ChunkingGraph) => string | undefined,
): Rolldown.CodeSplittingGroup[] {
	const runtimeKind = runtimeKindIn(outdir);
	return [
		{
			name: "grai-runtime",
			test: (id: string) => runtimeKind(id) !== undefined,
		},
		{
			name: (id: string, graph: ChunkingGraph) =>
				pageChunkOf(id, graph) ?? null,
			test: isMessageModule,
		},
	];
}

/** A chunk's file name: in a `grai/` within its directory when it holds messages and nothing else. */
export function chunkFileName(
	moduleIds: readonly string[],
	fileName: string,
): string {
	return messageOnly(moduleIds)
		? inDirectory(fileName, messageDirectory)
		: fileName;
}

/** A written chunk's names: before hashing, as `renderChunk` sees it, and after. */
type ChunkNames = { fileName: string; preliminaryFileName: string };

/**
 * Each message chunk's copies, one per locale. `render` keeps a chunk's copies as it is
 * rendered, before minification and before its hash is known; `emit` writes them once the
 * bundle's hashes are known, to `grai-<locale>/` beside the chunk.
 */
export type MessageChunkCopies = {
	render(
		fileName: string,
		moduleIds: readonly string[],
		code: string,
		locales: readonly string[],
	): void;
	emit(
		chunks: readonly ChunkNames[],
		minify: boolean,
		emit: (fileName: string, source: string) => void,
	): void;
};

export function messageChunkCopies(): MessageChunkCopies {
	const copies = new Map<string, Map<string, string>>();
	return {
		render(fileName, moduleIds, code, locales) {
			if (messageOnly(moduleIds))
				copies.set(fileName, localeCopies(fileName, code, locales));
		},
		emit(chunks, minify, emit) {
			const hashes = hashesOf(chunks);
			for (const chunk of chunks) {
				for (const [locale, code] of copies.get(chunk.preliminaryFileName) ??
					[]) {
					const linked = code.replaceAll(
						placeholder,
						(token) => hashes.get(token) ?? token,
					);
					emit(
						besideDirectory(chunk.fileName, localeDirectory(locale)),
						minify ? minifySync(chunk.fileName, linked).code : linked,
					);
				}
			}
		},
	};
}

/**
 * The bundler's placeholder for a chunk's hash, which its file name has until the bundle is written:
 * letters, digits, `_` or `$` between `!~{` and `}~`, as `!~{00c}~` in a build of a dozen chunks.
 */
const placeholder = /!~\{[\w$]+\}~/g;

/**
 * An error for each locale's text that holds a placeholder's shape, which a build refuses: the
 * bundler writes each chunk's hash over its placeholder wherever it is in the code, and grai each
 * copy's alike. No way of writing the text escapes that: the bundler prints a string by its value,
 * and folds an escaped template, a concatenation or a join back into one string, before the hashes
 * go in.
 */
export function placeholderTexts(build: Build): GraiError[] {
	const { catalogs, keys } = build.compilation;
	const fallbackOf = fallbackPositions(
		build.config.locales,
		build.config.fallbacks,
	);
	const errors: GraiError[] = [];
	for (const [key, { variants, parts }] of keys) {
		catalogs.forEach(({ file, locale }, index) => {
			const held = `${variants[index]}${parts[index] ?? ""}`.match(
				placeholder,
			)?.[0];
			if (held === undefined) return;
			const where = {
				file: messageSource(key, index, catalogs, fallbackOf)?.file ?? file,
				key,
				locale,
			};
			errors.push(
				new GraiError(
					"unsupported",
					where,
					`the text holds ${held}, the bundler's placeholder for a chunk's hash, which a build replaces with that hash. Write it without that shape, such as with a space after !~.`,
				),
			);
		});
	}
	return sortErrors(errors);
}

/** Each chunk's hash by its placeholder, from its file name before and after hashing. */
function hashesOf(chunks: readonly ChunkNames[]): Map<string, string> {
	const hashes = new Map<string, string>();
	for (const { fileName, preliminaryFileName } of chunks) {
		const token = preliminaryFileName.match(placeholder)?.[0];
		if (token === undefined) continue;
		const at = preliminaryFileName.indexOf(token);
		const after = preliminaryFileName.length - at - token.length;
		hashes.set(token, fileName.slice(at, fileName.length - after));
	}
	return hashes;
}
