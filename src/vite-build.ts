import { basename, dirname } from "node:path";
import { minifySync, type Rolldown } from "vite";
import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import { withoutContentHash } from "./content-names.ts";
import { GraiError, sortErrors } from "./error.ts";
import { fallbackPositions, messageSource } from "./fallbacks.ts";
import { freshName, keyExports } from "./key-exports.ts";
import { type KeyLinks, keyReach, type ModuleGraph } from "./key-reach.ts";
import { pageChunks } from "./key-sets.ts";
import {
	besideDirectory,
	inDirectory,
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	localeCopies,
	messageOnly,
	outputPrefix,
	textModulePrefix,
} from "./locale-chunks.ts";
import { localeDirectory, messageDirectory } from "./message-directories.ts";
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
	const shape = process.env.GRAI_SERVER_SHAPE;
	if (consumer === "server" && shape === "e")
		return serverSwitch(build, name, key);
	// Shape f: shape c for a message with inputs alone; markup keeps `markup`.
	if (consumer === "server" && shape === "f" && key.kind === "message")
		return serverDispatch(build, name, key, "c");
	if (consumer === "server" && key.kind !== "text" && shape && shape !== "f")
		return serverDispatch(build, name, key, shape);
	const names = calledNames([key]);
	const value = consumer === "server" ? key.serverValue : key.value;
	return `${outputImports(names, outputModule, build.rendered.modules)}\n${keyExports([{ name, value }], everyName(names))}`;
}

/**
 * PROTOTYPE, shape e: shape c for every key of a server build, a text's strings too. Each key is a
 * function of its own that switches on the locale's index, each locale's code inlined in it.
 */
function serverSwitch(build: Build, name: string, key: CompiledKey): string {
	const markup = key.kind === "markup";
	const names = calledNames(
		[key],
		markup ? ["localeIndex", "withParts"] : ["localeIndex"],
	);
	const bound = new Set([...everyName(names), name]);
	const o = freshName("o", bound);
	bound.add(o);
	const dispatch = (bodies: readonly string[]) => {
		const cases = bodies.map(
			(body, index) =>
				`${index === bodies.length - 1 ? "default" : `case ${index}`}: ${body}`,
		);
		return `function (i, ${o}) { switch (localeIndex(${o})) { ${cases.join(" ")} } }`;
	};
	const inlined = (
		functions: readonly { declarations: string; body: string }[],
	) =>
		dispatch(
			functions.map(
				({ declarations, body }) => `{ ${declarations}return ${body}; }`,
			),
		);
	const value =
		key.kind === "text"
			? dispatch(key.variants.map((text) => `return ${text};`))
			: markup
				? `/*#__PURE__*/ withParts(${inlined(key.functions.strings)}, ${inlined(key.functions.parts)})`
				: inlined(key.functions.strings);
	const taken = new Set(bound);
	taken.delete(name);
	return `${outputImports(names, outputModule, build.rendered.modules)}\n${keyExports([{ name, value }], taken)}`;
}

/** The runtime functions each prototype shape of a server build's dispatch calls. */
const shapeFunctions: Record<string, readonly string[]> = {
	a: ["dispatcher", "variantFor"],
	b: ["variantFor"],
	c: ["localeIndex"],
	d: ["localeIndex"],
};

/**
 * PROTOTYPE. A message with inputs or markup in a server build, dispatched by code of its own, so
 * that its call of a locale's function stays monomorphic:
 *   a  the runtime makes it from the key's own function, `dispatcher(function (v) {…}, […])`
 *   b  an array of the key's functions, and a function of its own that calls `variantFor`
 *   c  a switch on the locale's index, each locale's code inlined in the key's own function
 *   d  a function per locale, and a switch on the locale's index that calls it
 */
function serverDispatch(
	build: Build,
	name: string,
	key: CompiledKey,
	shape: string,
): string {
	const markup = key.kind === "markup";
	const functions = [
		...(shapeFunctions[shape] ?? []),
		...(markup ? ["withParts"] : []),
	];
	const names = calledNames([key], functions);
	const bound = new Set([...everyName(names), name]);
	const fresh = (wanted: string) => {
		const own = freshName(wanted, bound);
		bound.add(own);
		return own;
	};
	const o = fresh("o");
	const statements: string[] = [];
	const own = (
		locales: readonly {
			parameter: string;
			declarations: string;
			body: string;
		}[],
	) => {
		const written = locales.map(
			({ parameter, declarations, body }) =>
				`function (${parameter}) { ${declarations}return ${body}; }`,
		);
		switch (shape) {
			case "a":
				return `/*#__PURE__*/ dispatcher(function (v) { return function (i, ${o}) { return variantFor(v, ${o})(i); }; }, [${written.join(", ")}])`;
			case "b": {
				const v = fresh("v");
				statements.push(`const ${v} = [${written.join(", ")}];\n`);
				return `function (i, ${o}) { return variantFor(${v}, ${o})(i); }`;
			}
			case "c": {
				const cases = locales.map(
					({ declarations, body }, index) =>
						`${index === locales.length - 1 ? "default" : `case ${index}`}: { ${declarations}return ${body}; }`,
				);
				return `function (i, ${o}) { switch (localeIndex(${o})) { ${cases.join(" ")} } }`;
			}
			default: {
				const called = written.map((code) => {
					const local = fresh("$");
					statements.push(
						`function ${local}${code.slice("function ".length)}\n`,
					);
					return local;
				});
				const cases = called.map(
					(local, index) =>
						`${index === called.length - 1 ? "default" : `case ${index}`}: return ${local}(i);`,
				);
				return `function (i, ${o}) { switch (localeIndex(${o})) { ${cases.join(" ")} } }`;
			}
		}
	};
	const strings = own(key.functions.strings);
	const value = markup
		? `/*#__PURE__*/ withParts(${strings}, ${own(key.functions.parts)})`
		: strings;
	const taken = new Set(bound);
	taken.delete(name);
	return `${outputImports(names, outputModule, build.rendered.modules)}\n${statements.join("")}${keyExports([{ name, value }], taken)}`;
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

/**
 * The output's files that go to the `grai-runtime` chunk, with their kinds, by their names without
 * the hash of their content: the entries apps import and the modules they re-export alike.
 */
const runtimeFiles = new Map<string, GraiModuleKind>([
	["runtime.js", "runtime"],
	["internal.js", "runtime"],
	["config.js", "config"],
	["plurals.js", "plurals"],
	["formats.js", "formats"],
]);

/** The kind of the `grai-runtime` chunk's module an id is, in a project whose output is `outdir`. */
function runtimeKindIn(
	outdir: string,
): (id: string) => GraiModuleKind | undefined {
	return (id) =>
		dirname(id) === outdir
			? runtimeFiles.get(withoutContentHash(basename(id)))
			: undefined;
}

/** Which module of grai's an id is, in a project whose output is `outdir`; nothing for any other. */
export function moduleKindIn(
	outdir: string,
): (id: string) => GraiModuleKind | undefined {
	const runtimeKind = runtimeKindIn(outdir);
	return (id) => {
		if (id.startsWith(keyModulePrefix)) return "key";
		if (id.startsWith(textModulePrefix)) return "text";
		return runtimeKind(id);
	};
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
