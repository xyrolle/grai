import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { contentName } from "./content-names.ts";
import {
	type BaseCatalog,
	type DeclarationLine,
	shardMap,
} from "./declaration-maps.ts";
import { keyExports } from "./key-exports.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";
import {
	type OutputModules,
	type RuntimeSources,
	renderModules,
} from "./output-modules.ts";

/** A file of the output: its path in the outdir, and its text. */
export type OutputFile = readonly [path: string, text: string];

/**
 * The output, as a compile publishes it. The immutable files are named by their content, so a
 * compile writes each once and never replaces it. The mutable ones keep their names and are
 * replaced when their text changes: the entries apps import, which name the immutable files, and
 * each shard's declaration map.
 */
export type Output = {
	immutable: readonly OutputFile[];
	mutable: readonly OutputFile[];
};

/**
 * A shard's files as rendered: the name of its module and declarations, `<index>-<hash>` within
 * `keys/`, the module, the declarations and their map, `<index>.d.ts.map`, and the line of the
 * declarations each key is on.
 */
type ShardFiles = {
	name: string;
	module: string;
	declarations: string;
	map: string;
	lines: readonly DeclarationLine[];
};

/** The output's files by path, the modules the keys import, and each shard's keys and files. */
export type Rendered = {
	files: ReadonlyMap<string, string>;
	modules: OutputModules;
	/** Each shard's keys, sorted. */
	shards: readonly (readonly string[])[];
	/** The files of each shard that holds keys, by its index. */
	shardFiles: ReadonlyMap<number, ShardFiles>;
};

/** The output's .gitignore: everything in it is compiled from the catalogs, so none of it is committed. */
const gitignore = "# grai writes this directory from the catalogs.\n*\n";

/** About how many keys a shard holds, so an edit rewrites one small module and its declarations. */
const keysPerShard = 512;

/** `m`, the namespace of keys.js, as messages.js and its declarations export it. */
const messagesModule = `export * as m from "./keys.js";\n`;

/**
 * Renders the output. The keys are split into shards by a hash of their name, so a key stays in
 * its shard while others come and go; only the shards whose keys changed are rendered again, and
 * every shard when a module they import is renamed.
 */
export function renderOutput(
	config: Config,
	runtime: RuntimeSources,
	compilation: Compilation,
	base: BaseCatalog,
	{ localeCopies }: { localeCopies: boolean },
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const { modules, immutable, entries } = renderModules(
		config,
		runtime,
		compilation,
		localeCopies,
	);
	const count = shardCount(compilation.keys.size);
	const before =
		previous?.shards.length === count && sameModules(previous.modules, modules)
			? previous
			: undefined;
	const dirty = new Set<number>();
	for (const key of compilation.changed) dirty.add(shardOf(key, count));
	const shards =
		before === undefined
			? groupKeys(compilation.keys.keys(), count)
			: before.shards.map((keys, index) =>
					dirty.has(index) ? regroup(keys, index, count, compilation) : keys,
				);
	const shardFiles = new Map<number, ShardFiles>();
	shards.forEach((keys, index) => {
		if (keys.length === 0) return;
		const previousFiles = before?.shardFiles.get(index);
		const shard =
			dirty.has(index) || previousFiles === undefined
				? renderShard(index, keys, compilation, modules)
				: previousFiles;
		const map = shardMap(
			`${shard.name}.d.ts`,
			shard.lines,
			base,
			config.outdir,
			previousFiles === undefined
				? undefined
				: { ...previousFiles, file: `${previousFiles.name}.d.ts` },
		);
		shardFiles.set(index, { ...shard, map });
	});
	const files = [...shardFiles.values()];
	const keysIndex = files
		.map(({ name }) => `export * from "./keys/${name}.js";\n`)
		.join("");
	const output: Output = {
		immutable: [
			...immutable,
			...files.flatMap(({ name, module, declarations }): OutputFile[] => [
				[`keys/${name}.js`, module],
				[`keys/${name}.d.ts`, declarations],
			]),
		],
		mutable: [
			[".gitignore", gitignore],
			...[...shardFiles].map(
				([index, { map }]): OutputFile => [`keys/${index}.d.ts.map`, map],
			),
			...entries,
			["keys.js", keysIndex],
			["keys.d.ts", keysIndex],
			["messages.js", messagesModule],
			["messages.d.ts", messagesModule],
		],
	};
	return {
		output,
		rendered: {
			files: new Map([...output.immutable, ...output.mutable]),
			modules,
			shards,
			shardFiles,
		},
	};
}

function sameModules(a: OutputModules, b: OutputModules): boolean {
	return (
		a.runtime === b.runtime &&
		a.plurals === b.plurals &&
		a.formats === b.formats
	);
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

/**
 * A shard's module and declarations, named by their content. They share the name so that
 * TypeScript reads the declarations rather than the module, as it does any `.js` beside its
 * `.d.ts`; the declarations name their map by the shard's index.
 */
function renderShard(
	index: number,
	keys: readonly string[],
	compilation: Compilation,
	modules: OutputModules,
): Omit<ShardFiles, "map"> {
	const compiled = new Map<string, CompiledKey>();
	for (const key of keys) {
		const compiledKey = compilation.keys.get(key);
		if (compiledKey !== undefined) compiled.set(key, compiledKey);
	}
	const module = shardModule([...compiled.values()], modules);
	const { body, lines } = shardDeclarations(compiled, modules);
	const declarations = `${body}//# sourceMappingURL=${index}.d.ts.map\n`;
	const name = contentName(String(index), module, declarations);
	return { name, module, declarations, lines };
}

function shardModule(
	keys: readonly CompiledKey[],
	modules: OutputModules,
): string {
	const names = calledNames(keys);
	return `${outputImports(names, (file) => `../${file}`, modules)}\n\n${keyExports(keys, everyName(names))}`;
}

/** A shard's declarations, but the line naming their map, and the line each key's is on. */
function shardDeclarations(
	keys: ReadonlyMap<string, CompiledKey>,
	modules: OutputModules,
): { body: string; lines: DeclarationLine[] } {
	const types = [...keys.values()].some((key) => key.markup)
		? "MarkupMessage, Message"
		: "Message";
	const parts = [`import type { ${types} } from "../${modules.runtime}";\n\n`];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const [name, key] of keys) {
		line += key.declarationLines;
		lines.push([name, line - 1]);
		parts.push(key.declaration);
	}
	return { body: parts.join(""), lines };
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
