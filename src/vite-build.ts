import { join } from "node:path";
import { type EnvironmentOptions, minifySync } from "vite";
import type { Build } from "./compile.ts";
import {
	besideDirectory,
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	localeCopies,
	localeDirectory,
	messageDirectory,
	messageOnly,
	textModulePrefix,
} from "./locale-chunks.ts";
import { outputImports } from "./output-imports.ts";

/** keys.js in a build: each key from its own module, so a chunk holds only the keys its code uses. */
export function keysModule(build: Build): string {
	return [...build.compilation.keys.keys()]
		.map((key) => `export { ${key} } from "${keyPrefix}${key}";`)
		.join("\n");
}

/**
 * A key's module in a build, from the compiler's model, or nothing for an id that is no key's: the
 * key's code for the browser, or its code for a server.
 */
export function keyModule(
	outdir: string,
	build: Build,
	id: string,
	consumer: "client" | "server",
): string | undefined {
	const key = build.compilation.keys.get(id.slice(keyModulePrefix.length));
	if (key === undefined) return undefined;
	const code = consumer === "server" ? key.serverCode : key.code;
	return `${outputImports(outdir, [key], key.uses)}\n${code}`;
}

/**
 * A text key's string module in a client build: its text in the page's locale, chosen once. Its
 * variants are the key's, so each locale's copy of its chunk keeps only that locale's words.
 */
export function textModule(
	outdir: string,
	build: Build,
	id: string,
): string | undefined {
	const name = id.slice(textModulePrefix.length);
	const key = build.compilation.keys.get(name);
	if (key?.kind !== "text") return undefined;
	return `${outputImports(outdir, [key], ["pageText"])}\nexport const ${name} = /*#__PURE__*/ pageText(${key.variants.join(", ")});\n`;
}

/**
 * A module grai's client build puts in a chunk of its own. The runtime and the modules it reads
 * (`runtime`, `config`, `plurals`, `formats`) go to the `grai-runtime` chunk; a key's module
 * (`key`) and a text key's string module (`text`) go to the message chunks under `grai/`.
 */
export type GraiModuleKind =
	| "runtime"
	| "config"
	| "plurals"
	| "formats"
	| "key"
	| "text";

/** The output's files that go to the `grai-runtime` chunk, with their kinds. */
const runtimeFiles = new Map<string, GraiModuleKind>([
	["runtime.js", "runtime"],
	["config.js", "config"],
	["plurals.js", "plurals"],
	["formats.js", "formats"],
]);

/** The `grai-runtime` chunk's modules in a project whose output is `outdir`, by id. */
function runtimeModules(outdir: string): Map<string, GraiModuleKind> {
	return new Map(
		[...runtimeFiles].map(([file, kind]) => [join(outdir, file), kind]),
	);
}

/** Which module of grai's an id is, in a project whose output is `outdir`; nothing for any other. */
export function moduleKindIn(
	outdir: string,
): (id: string) => GraiModuleKind | undefined {
	const runtime = runtimeModules(outdir);
	return (id) => {
		if (id.startsWith(keyModulePrefix)) return "key";
		if (id.startsWith(textModulePrefix)) return "text";
		return runtime.get(id);
	};
}

/**
 * The client build's chunking: the runtime in a chunk of its own, and the keys in chunks by the
 * entries that use them, so a message chunk holds keys and nothing else.
 */
export function messageChunking(outdir: string): EnvironmentOptions {
	const runtime = runtimeModules(outdir);
	const groups = [
		{ name: "grai-runtime", test: (id: string) => runtime.has(id) },
		{
			name: messageDirectory,
			test: isMessageModule,
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
