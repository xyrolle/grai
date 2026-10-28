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
 * A file of the output: its path in the outdir, its text, and, for a mutable file whose render took
 * it, the SHA-1 of its text, which the write then does not take again.
 */
export type OutputFile = readonly [path: string, text: string, hash?: string];

/**
 * The output, as a compile publishes it. The immutable files are named by their content, so a
 * compile writes each once and never replaces it. The mutable ones keep their names and are
 * replaced when their text changes: the entries apps import, which name the immutable files, and
 * each place's declarations, which keep its module's name, and their map.
 */
export type Output = {
	immutable: readonly OutputFile[];
	mutable: readonly OutputFile[];
};

/** Each file of an output, its text by its path. */
export function textsOf(output: Output): Map<string, string> {
	return new Map(
		[...output.immutable, ...output.mutable].map(([path, text]) => [
			path,
			text,
		]),
	);
}

/**
 * A place's files as rendered (`key-placement.ts`): the name of its module and declarations,
 * `<label>-<hash>` within `keys/`, named by the module's content, the module, and, once its keys
 * are declared, the declarations, their map, `<label>.d.ts.map`, and the line of the declarations
 * each key is on.
 */
type ShardFiles = {
	name: string;
	module: string;
	declared?: {
		declarations: string;
		/** The declarations' hash, taken once as they are rendered. */
		hash: string;
		map: string;
		lines: readonly DeclarationLine[];
	};
};

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
 * anew. A place rendered before without its declarations (`renderUndeclared`) is declared now.
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
	for (const {
		index,
		label,
		keys,
		name,
		module,
		before,
		kept,
	} of places.modules) {
		const declared =
			kept?.declared ??
			shardDeclarations(label, keysOf(keys, compilation), rendered.modules);
		const map = shardMap(
			`${name}.d.ts`,
			declared.lines,
			base,
			config.outdir,
			before?.declared === undefined
				? undefined
				: { ...before.declared, file: `${before.name}.d.ts` },
		);
		shardFiles.set(index, { name, module, declared: { ...declared, map } });
	}
	const files = [...shardFiles.values()];
	const keysIndex = indexOf(files);
	const output: Output = {
		immutable: [
			...rendered.moduleFiles.immutable,
			...files.map(
				({ name, module }): OutputFile => [`keys/${name}.js`, module],
			),
		],
		mutable: [
			...rendered.moduleFiles.mutable,
			...[...shardFiles].flatMap(
				([index, { name, declared }]): OutputFile[] => [
					[`keys/${name}.d.ts`, declared.declarations, declared.hash],
					[`keys/${places.placement.label(index)}.d.ts.map`, declared.map],
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
 * starting from it needs, its declarations left to the write after (`writeBuild`). A module is named
 * by its content alone, so the write after names it alike, and writes no module again.
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
	for (const { index, name, module } of places.modules)
		shardFiles.set(index, { name, module });
	const files = [...shardFiles.values()];
	const undeclared = ([path]: OutputFile) => !isDeclarations(path);
	const output: Output = {
		immutable: [
			...rendered.moduleFiles.immutable.filter(undeclared),
			...files.map(
				({ name, module }): OutputFile => [`keys/${name}.js`, module],
			),
		],
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
 * A place that holds keys: its index and label, its keys, its name and module, its files rendered before,
 * and those again if its module is the one rendered then.
 */
type Place = {
	index: number;
	label: string;
	keys: readonly string[];
	/** `<label>-<hash>`, by the module's content. */
	name: string;
	module: string;
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
		const module =
			kept?.module ??
			shardModule(
				[...keysOf(keys, compilation).values()],
				modules,
				config.locales,
			);
		places.push({
			index,
			label,
			keys,
			name: kept?.name ?? contentName(label, module),
			module,
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
		files: textsOf(output),
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
 * A shard's module. It first checks that the runtime it reached through the anchor reads the
 * locales its keys were compiled for, at their positions, as a process that loaded the anchor of
 * one compile and the keys of another may not.
 */
function shardModule(
	keys: readonly CompiledKey[],
	modules: OutputModules,
	locales: readonly string[],
): string {
	// Each shard checks, as it is evaluated, that the runtime was compiled for its locales.
	const uses = new Set<string>(["assertCompiledFor"]);
	for (const key of keys) for (const name of key.uses) uses.add(name);
	const names = calledNames(keys, uses);
	return `${outputImports(names, (file) => `../${file}`, modules)}\n\nassertCompiledFor(${JSON.stringify(locales)});\n${keyExports(keys, everyName(names))}`;
}

/**
 * A place's declarations, the line naming their map last, and the line each key's is on. They share
 * the module's name so that TypeScript reads the declarations rather than the module, as it does
 * any `.js` beside its `.d.ts`, and leaves the module out of a project that type-checks JavaScript;
 * they name their map by the place's label.
 */
function shardDeclarations(
	label: string,
	keys: ReadonlyMap<string, DeclaredKey>,
	modules: OutputModules,
): { declarations: string; hash: string; lines: DeclarationLine[] } {
	const types = [...keys.values()].some((key) => key.markup)
		? "MarkupMessage, Message"
		: "Message";
	const parts = [`import type { ${types} } from "../${modules.runtime}";\n\n`];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const [name, key] of keys) {
		line += key.declared.lines;
		lines.push([name, line - 1]);
		parts.push(key.declared.text);
	}
	parts.push(`//# sourceMappingURL=${label}.d.ts.map\n`);
	const declarations = parts.join("");
	return { declarations, hash: hash("sha1", declarations), lines };
}
