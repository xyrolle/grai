import { join, relative } from "node:path";
import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { declarationMap, type Position } from "./declaration-maps.ts";
import { runtimeDeclarations, serverDeclarations } from "./declarations.ts";
import type { RuntimeFunction } from "./modules.ts";
import { pluralModule, pluralName } from "./plurals.ts";

/** The output's files, level by level: a file imports only files of earlier levels. */
export type Output = readonly (readonly (readonly [string, string])[])[];

/** The output's files by name, in write order, and each shard's keys, sorted. */
export type Rendered = {
	files: ReadonlyMap<string, string>;
	shards: readonly (readonly string[])[];
	/** Each shard's keys, with the line of the shard's declarations each one is on. */
	lines: readonly (readonly DeclarationLine[])[];
};

/** A key, and the line of its shard's declarations its declaration is on. */
type DeclarationLine = readonly [key: string, line: number];

/**
 * The base locale's catalog, for the declaration maps: its path, where each key is in it, and
 * whether that can differ from where the previous render had them.
 */
export type BaseCatalog = {
	path: string;
	positions: ReadonlyMap<string, Position>;
	moved: boolean;
};

/** Where a shard's declarations put each key's name: after `export declare const `. */
const nameColumn = "export declare const ".length;

/** About how many keys a shard holds, so an edit rewrites one small module and its declarations. */
const keysPerShard = 512;

/**
 * Renders the output. The keys are split into shards by a hash of their name, so a key stays in
 * its shard while others come and go; only the shards whose keys changed are rendered again.
 */
export function renderOutput(
	config: Config,
	runtime: { runtime: string; server: string },
	compilation: Compilation,
	base: BaseCatalog,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const count = shardCount(compilation.keys.size);
	const before = previous?.shards.length === count ? previous : undefined;
	const dirty = new Set<number>();
	for (const key of compilation.changed) dirty.add(shardOf(key, count));
	const shards =
		before === undefined
			? groupKeys(compilation.keys.keys(), count)
			: before.shards.map((keys, index) =>
					dirty.has(index) ? regroup(keys, index, count, compilation) : keys,
				);
	const declarations: [string, string][] = [];
	const modules: [string, string][] = [];
	const catalog = relative(join(config.outdir, "keys"), base.path);
	const lines: (readonly DeclarationLine[])[] = [];
	shards.forEach((keys, index) => {
		lines[index] = [];
		if (keys.length === 0) return;
		const files = shardFiles(index);
		const kept = dirty.has(index) ? undefined : keptShard(index, files, before);
		const shard = kept ?? renderShard(index, keys, compilation);
		const map =
			kept !== undefined && !base.moved
				? kept.map
				: declarationMap(
						`${index}.d.ts`,
						catalog,
						shard.lines,
						base.positions,
						nameColumn,
					);
		lines[index] = shard.lines;
		modules.push([files.module, shard.module]);
		declarations.push(
			[files.declarations, shard.declarations],
			[files.map, map],
		);
	});
	const keysIndex = modules
		.map(([file]) => `export * from "./${file}";\n`)
		.join("");
	const output: Output = [
		[
			["config.js", configModule(config)],
			["runtime.d.ts", runtimeDeclarations(config)],
			["server.d.ts", serverDeclarations],
			["plurals.js", pluralModule(config.locales)],
		],
		[["runtime.js", runtime.runtime], ...declarations],
		[["server.js", runtime.server]],
		[...modules, ["keys.d.ts", keysIndex]],
		[
			["keys.js", keysIndex],
			["messages.d.ts", `export * as m from "./keys.js";\n`],
		],
		[["messages.js", `export * as m from "./keys.js";\n`]],
	];
	return {
		output,
		rendered: { files: new Map(output.flat()), shards, lines },
	};
}

/** Every key in its shard, each shard's keys sorted. */
function groupKeys(keys: Iterable<string>, count: number): string[][] {
	const shards = Array.from({ length: count }, (): string[] => []);
	for (const key of keys) shards[shardOf(key, count)]?.push(key);
	for (const shard of shards) shard.sort();
	return shards;
}

/** A shard's keys, sorted, after the changed keys of that shard came or went. */
function regroup(
	keys: readonly string[],
	index: number,
	count: number,
	compilation: Compilation,
): string[] {
	const next = new Set(keys);
	for (const key of compilation.changed) {
		if (shardOf(key, count) !== index) continue;
		if (compilation.keys.has(key)) next.add(key);
		else next.delete(key);
	}
	return [...next].sort();
}

function shardModule(keys: readonly CompiledKey[]): string {
	const uses = new Set<RuntimeFunction>();
	const plurals = new Set<string>();
	for (const key of keys) {
		for (const name of key.uses) uses.add(name);
		for (const locale of key.plurals) plurals.add(pluralName(locale));
	}
	const imports = [
		`import { ${[...uses].sort().join(", ")} } from "../runtime.js";\n`,
	];
	if (plurals.size > 0) {
		imports.push(
			`import { ${[...plurals].sort().join(", ")} } from "../plurals.js";\n`,
		);
	}
	const code = keys.map((key) => key.code).join("");
	return `${imports.join("")}\n${code}`;
}

/** A shard's files: its module, its declarations and their map. */
type ShardFiles = { module: string; declarations: string; map: string };

/** A shard's module and declarations, its declarations' map, and the line of each declaration. */
type Shard = ShardFiles & { lines: readonly DeclarationLine[] };

function shardFiles(index: number): ShardFiles {
	const declarations = `keys/${index}.d.ts`;
	return {
		module: `keys/${index}.js`,
		declarations,
		map: `${declarations}.map`,
	};
}

/** A shard as the previous render left it, if it has all of its files. */
function keptShard(
	index: number,
	files: ShardFiles,
	previous: Rendered | undefined,
): Shard | undefined {
	const module = previous?.files.get(files.module);
	const declarations = previous?.files.get(files.declarations);
	const map = previous?.files.get(files.map);
	const lines = previous?.lines[index];
	return module === undefined ||
		declarations === undefined ||
		map === undefined ||
		lines === undefined
		? undefined
		: { module, declarations, map, lines };
}

/** A shard's module and declarations, and the line each declaration is on, for its map. */
function renderShard(
	index: number,
	keys: readonly string[],
	compilation: Compilation,
): Omit<Shard, "map"> {
	const compiled: CompiledKey[] = [];
	const types = keys.some((key) => compilation.keys.get(key)?.markup)
		? "MarkupMessage, Message"
		: "Message";
	const parts = [`import type { ${types} } from "../runtime.js";\n\n`];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const name of keys) {
		const key = compilation.keys.get(name);
		if (key === undefined) continue;
		compiled.push(key);
		line += key.declarationLines;
		lines.push([name, line - 1]);
		parts.push(key.declaration);
	}
	parts.push(`//# sourceMappingURL=${index}.d.ts.map\n`);
	return { module: shardModule(compiled), declarations: parts.join(""), lines };
}

/** A power of two, so a key changes shard only when the key count doubles. */
function shardCount(keys: number): number {
	let shards = 1;
	while (shards * keysPerShard < keys) shards *= 2;
	return shards;
}

/** The shard of a key: its name's FNV-1a hash, modulo the shard count. */
function shardOf(key: string, shards: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index++) {
		hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
	}
	return (hash >>> 0) % shards;
}

/** config.js: the project's config, as the runtime reads it. */
function configModule(config: Config): string {
	return [
		`export const locales = ${JSON.stringify(config.locales)};`,
		`export const baseLocale = ${JSON.stringify(config.baseLocale)};`,
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		`export const cookieName = ${config.cookieName === undefined ? "undefined" : JSON.stringify(config.cookieName)};`,
		"",
	].join("\n");
}
