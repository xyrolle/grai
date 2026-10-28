import { hash } from "node:crypto";
import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { contentName } from "./content-names.ts";
import {
	type BaseCatalog,
	type DeclarationLine,
	shardMap,
} from "./declaration-maps.ts";
import type { DeclaredKey } from "./key-declarations.ts";
import { keyExports } from "./key-exports.ts";
import { placedKeys, placementOf, replaced } from "./key-placement.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";
import type { OutputModules, RenderedModules } from "./output-modules.ts";
import type { KeyGroups } from "./saved-groups.ts";

/**
 * A file of the output: its path in the outdir, its text, and, for a module of keys, the hash of
 * its text, taken once as it is rendered, so that a compile hashes only the modules it renders.
 */
export type OutputFile = readonly [path: string, text: string, sha1?: string];

/** The texts of lists of files, by their paths. */
export function textsByPath(
	...lists: (readonly OutputFile[])[]
): Map<string, string> {
	return new Map(lists.flat().map(([path, text]) => [path, text]));
}

/**
 * The output, as a compile publishes it, in the order it is renamed into place:
 * - `immutable`: the files named by their content, which a compile writes once and never replaces;
 * - `keyModules`: the modules of keys and their declarations, named by their shape (`renderShard`),
 *   which a compile replaces in place when only their messages change;
 * - `mutable`: the files with names of their own, replaced when their text changes: the entries
 *   apps import, which name the files above, and each module of keys' declaration map.
 */
export type Output = {
	immutable: readonly OutputFile[];
	keyModules: readonly OutputFile[];
	mutable: readonly OutputFile[];
};

/**
 * A place's files as rendered (`key-placement.ts`): the name of its module and declarations,
 * `<label>-<hash>` within `keys/`, the module with the hash of its text, and, once its keys are
 * declared, the declarations with the hash of theirs, their map, `<label>.d.ts.map`, and the line
 * of the declarations each key is on.
 */
type ShardFiles = ModuleFiles & {
	declared?: {
		declarations: string;
		declarationsHash: string;
		map: string;
		lines: readonly DeclarationLine[];
	};
};

/** A place's module, its name, and the hash of its text. */
type ModuleFiles = { name: string; module: string; moduleHash: string };

/** The whole output rendered: the modules beside the keys, and each place's keys and files. */
export type Rendered = RenderedModules & {
	/** The groups the keys were placed by, as JSON. */
	groups: string;
	/** Each place's keys, sorted. */
	shards: readonly (readonly string[])[];
	/** The files of each place that holds keys, by its index. */
	shardFiles: ReadonlyMap<number, ShardFiles>;
};

/**
 * Renders the output: the modules beside the keys, as rendered, and the keys. Each key's module is
 * its group's, when the saved groups hold it, else its shard's, by a hash of its name, so a key stays
 * in its place while others come and go (`key-placement.ts`). Only the places whose keys changed
 * are rendered again, and those that import a module renamed: every place for the runtime, and for
 * the plural rules or the formatters, the places whose keys call them. Other groups place every key
 * anew. A place whose module was rendered without its declarations (`renderUndeclared`) is declared
 * now, its module kept.
 */
export function renderOutput(
	config: Config,
	rendered: RenderedModules,
	compilation: Compilation<DeclaredKey>,
	base: BaseCatalog,
	groups: KeyGroups,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const places = placed(config, rendered, compilation, groups, previous);
	const shardFiles = new Map<number, Required<ShardFiles>>();
	for (const { index, label, keys, module, kept, before } of places.modules) {
		const declared =
			kept?.declared ??
			shardDeclarations(label, keysOf(keys, compilation), rendered.modules);
		const map = shardMap(
			`${module.name}.d.ts`,
			declared.lines,
			base,
			config.outdir,
			before?.declared === undefined
				? undefined
				: { ...before.declared, file: `${before.name}.d.ts` },
		);
		shardFiles.set(index, { ...module, declared: { ...declared, map } });
	}
	const files = [...shardFiles.values()];
	const keysIndex = indexOf(files);
	const output: Output = {
		immutable: rendered.moduleFiles.immutable,
		keyModules: files.flatMap((shard): OutputFile[] => [
			[`keys/${shard.name}.js`, shard.module, shard.moduleHash],
			[
				`keys/${shard.name}.d.ts`,
				shard.declared.declarations,
				shard.declared.declarationsHash,
			],
		]),
		mutable: [
			...rendered.moduleFiles.mutable,
			...[...shardFiles].map(
				([index, { declared }]): OutputFile => [
					`keys/${places.placement.label(index)}.d.ts.map`,
					declared.map,
				],
			),
			["keys.js", keysIndex],
			["keys.d.ts", keysIndex],
		],
	};
	return {
		output,
		rendered: renderedWith(rendered, output, places, shardFiles),
	};
}

/**
 * The output as `renderOutput` renders it, but without any declarations or their maps, for keys
 * compiled but not declared yet: every module the output's modules import, whole, as a dev server
 * starting from it needs, its declarations left to the write after (`writeBuild`). A module is
 * named by its shape, which its declarations do not change, so the write after names it alike and
 * writes no module again.
 */
export function renderUndeclared(
	config: Config,
	rendered: RenderedModules,
	compilation: Compilation,
	groups: KeyGroups,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const places = placed(config, rendered, compilation, groups, previous);
	const shardFiles = new Map<number, ShardFiles>();
	for (const { index, module } of places.modules) {
		const { name, module: text, moduleHash } = module;
		shardFiles.set(index, { name, module: text, moduleHash });
	}
	const files = [...shardFiles.values()];
	const undeclared = ([path]: OutputFile) => !isDeclarations(path);
	const output: Output = {
		immutable: rendered.moduleFiles.immutable.filter(undeclared),
		keyModules: files.map(
			(shard): OutputFile => [
				`keys/${shard.name}.js`,
				shard.module,
				shard.moduleHash,
			],
		),
		mutable: [
			...rendered.moduleFiles.mutable.filter(undeclared),
			["keys.js", indexOf(files)],
		],
	};
	return {
		output,
		rendered: renderedWith(rendered, output, places, shardFiles),
	};
}

/** Whether an output's file is declarations or their map, which a dev server never imports. */
function isDeclarations(path: string): boolean {
	return path.endsWith(".d.ts") || path.endsWith(".d.ts.map");
}

/** keys.js, which re-exports every place's module. */
function indexOf(files: readonly ShardFiles[]): string {
	return files
		.map(({ name }) => `export * from "./keys/${name}.js";\n`)
		.join("");
}

/** The keys a place holds, compiled. */
function keysOf<Key extends CompiledKey>(
	keys: readonly string[],
	compilation: Compilation<Key>,
): Map<string, Key> {
	const compiled = new Map<string, Key>();
	for (const key of keys) {
		const compiledKey = compilation.keys.get(key);
		if (compiledKey !== undefined) compiled.set(key, compiledKey);
	}
	return compiled;
}

/**
 * A place that holds keys: its index and label, its keys, its module, its files rendered before,
 * and those again if its module is the one rendered then.
 */
type Place = {
	index: number;
	label: string;
	keys: readonly string[];
	module: ModuleFiles;
	before: ShardFiles | undefined;
	kept: ShardFiles | undefined;
};

/**
 * Each place's keys and module: the module rendered again for a place whose keys changed or that
 * imports a module renamed, else the one rendered before.
 */
function placed(
	config: Config,
	rendered: RenderedModules,
	compilation: Compilation,
	groups: KeyGroups,
	previous: Rendered | undefined,
) {
	const { modules } = rendered;
	const placement = placementOf(groups, compilation.keys.keys());
	const before =
		previous?.shards.length === placement.count &&
		previous.groups === placement.groups &&
		previous.modules.runtime === modules.runtime
			? previous
			: undefined;
	const dirty = new Set<number>();
	for (const key of compilation.changed) dirty.add(placement.of(key));
	if (before !== undefined) {
		before.shards.forEach((keys, index) => {
			if (
				!dirty.has(index) &&
				importsRenamed(keys, compilation, before.modules, modules)
			)
				dirty.add(index);
		});
	}
	const shards =
		before === undefined
			? placedKeys(compilation.keys.keys(), placement)
			: before.shards.map((keys, index) =>
					dirty.has(index)
						? replaced(keys, index, placement, compilation)
						: keys,
				);
	const places: Place[] = [];
	shards.forEach((keys, index) => {
		if (keys.length === 0) return;
		const previousFiles = before?.shardFiles.get(index);
		const kept = dirty.has(index) ? undefined : previousFiles;
		const label = placement.label(index);
		places.push({
			index,
			label,
			keys,
			module:
				kept ??
				renderShard(label, keysOf(keys, compilation), modules, config.locales),
			before: previousFiles,
			kept,
		});
	});
	return { placement, shards, modules: places };
}

/** The rendered output, for the next render to start from. */
function renderedWith(
	rendered: RenderedModules,
	output: Output,
	places: ReturnType<typeof placed>,
	shardFiles: ReadonlyMap<number, ShardFiles>,
): Rendered {
	return {
		...rendered,
		files: textsByPath(output.immutable, output.keyModules, output.mutable),
		groups: places.placement.groups,
		shards: places.shards,
		shardFiles,
	};
}

/**
 * Whether a shard's keys call the plural rules or the formatters, and that module was renamed. A
 * change of one key's format options renames formats.js, and only the shards that import it name it.
 */
function importsRenamed(
	keys: readonly string[],
	compilation: Compilation,
	before: OutputModules,
	after: OutputModules,
): boolean {
	const plurals = before.plurals !== after.plurals;
	const formats = before.formats !== after.formats;
	if (!plurals && !formats) return false;
	return keys.some((key) => {
		const compiled = compilation.keys.get(key);
		return (
			compiled !== undefined &&
			((plurals && compiled.plurals.size > 0) ||
				(formats && compiled.formats.size > 0))
		);
	});
}

/**
 * A place's module, named by its shape: the keys it holds, each with its signature (the inputs and
 * markup a call passes and gets), and the head of the module and of its declarations, which name
 * what they import and the locales the keys were compiled for. Its declarations share the name, and
 * their text does not change it, so a module written before its declarations is named alike
 * (`renderUndeclared`). An edit that changes only the words of messages keeps the name, so the
 * compile replaces the module and the declarations in place, each renamed over the old one at once,
 * and the entries that name them stay as they are: a bundler watching the outdir then compiles that
 * module again and nothing else. A change of shape renames them, and keys.js with them, so a reader
 * loads one compile's layout, and calls each key as that layout's keys.js has it. They share the
 * name so that TypeScript reads the declarations rather than the module, as it does any `.js` beside
 * its `.d.ts`, and leaves the module out of a project that type-checks JavaScript; the declarations
 * name their map by the place's label.
 */
function renderShard(
	label: string,
	keys: ReadonlyMap<string, CompiledKey>,
	modules: OutputModules,
	locales: readonly string[],
): ModuleFiles {
	const module = shardModule([...keys.values()], modules, locales);
	const name = contentName(
		label,
		module.head,
		declarationsHead(keys.values(), modules),
		[...keys].map(([key, { signature }]) => `${key} ${signature}`).join("\n"),
	);
	const text = `${module.head}${module.body}`;
	return { name, module: text, moduleHash: hash("sha1", text) };
}

/**
 * A shard's module: its head, which imports what its keys call and first checks that the runtime
 * it reached through the anchor reads the locales its keys were compiled for, at their positions,
 * as a process that loaded the anchor of one compile and the keys of another may not; and its body,
 * the keys.
 */
function shardModule(
	keys: readonly CompiledKey[],
	modules: OutputModules,
	locales: readonly string[],
): { head: string; body: string } {
	// Each shard checks, as it is evaluated, that the runtime was compiled for its locales.
	const uses = new Set<string>(["assertCompiledFor"]);
	for (const key of keys) for (const name of key.uses) uses.add(name);
	const names = calledNames(keys, uses);
	return {
		head: `${outputImports(names, (file) => `../${file}`, modules)}\n\nassertCompiledFor(${JSON.stringify(locales)});\n`,
		body: keyExports(keys, everyName(names)),
	};
}

/**
 * A place's declarations, the line naming their map last, with the hash of their text and the line
 * each key's is on.
 */
function shardDeclarations(
	label: string,
	keys: ReadonlyMap<string, DeclaredKey>,
	modules: OutputModules,
): {
	declarations: string;
	declarationsHash: string;
	lines: DeclarationLine[];
} {
	const parts = [declarationsHead(keys.values(), modules)];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const [name, key] of keys) {
		line += key.declared.lines;
		lines.push([name, line - 1]);
		parts.push(key.declared.text);
	}
	parts.push(`//# sourceMappingURL=${label}.d.ts.map\n`);
	const declarations = parts.join("");
	return { declarations, declarationsHash: hash("sha1", declarations), lines };
}

/** The head of a place's declarations, which imports the types they name, whether declared or not. */
function declarationsHead(
	keys: Iterable<CompiledKey>,
	modules: OutputModules,
): string {
	const types = [...keys].some((key) => key.markup)
		? "MarkupMessage, Message"
		: "Message";
	return `import type { ${types} } from "../${modules.runtime}";\n\n`;
}
