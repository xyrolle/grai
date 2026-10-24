import { join } from "node:path";
import { type EnvironmentOptions, minifySync } from "vite";
import type { Build } from "./compile.ts";
import {
	besideDirectory,
	keyModulePrefix,
	keyPrefix,
	localeCopies,
	localeDirectory,
	messageDirectory,
	messageOnly,
} from "./locale-chunks.ts";
import { outputImports } from "./output-imports.ts";

/** keys.js in a build: each key from its own module, so a chunk holds only the keys its code uses. */
export function keysModule(build: Build): string {
	return [...build.compilation.keys.keys()]
		.map((key) => `export { ${key} } from "${keyPrefix}${key}";`)
		.join("\n");
}

/** A key's module in a build, from the compiler's model, or nothing for an id that is no key's. */
export function keyModule(
	outdir: string,
	build: Build,
	id: string,
): string | undefined {
	const key = build.compilation.keys.get(id.slice(keyModulePrefix.length));
	if (key === undefined) return undefined;
	return `${outputImports(outdir, [key], key.uses)}\n${key.code}`;
}

/**
 * The client build's chunking: the runtime in a chunk of its own, and the keys in chunks by the
 * entries that use them, so a message chunk holds keys and nothing else.
 */
export function messageChunking(outdir: string): EnvironmentOptions {
	const runtime = new Set(
		["runtime.js", "config.js", "plurals.js"].map((file) => join(outdir, file)),
	);
	const groups = [
		{ name: "grai-runtime", test: (id: string) => runtime.has(id) },
		{
			name: messageDirectory,
			test: (id: string) => id.startsWith(keyModulePrefix),
			entriesAware: true,
		},
	];
	return {
		build: { rolldownOptions: { output: { codeSplitting: { groups } } } },
	};
}

/** A chunk's file name: under `grai/` when it holds messages and nothing else. */
export function chunkFileName(
	moduleIds: readonly string[],
	fileName: string,
): string {
	return messageOnly(moduleIds)
		? besideDirectory(fileName, messageDirectory)
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

/** The bundler's placeholder for a chunk's hash, which its file name has until the bundle is written. */
const placeholder = /!~\{\d+\}~/g;

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
