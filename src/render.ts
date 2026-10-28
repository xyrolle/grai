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
 * A place's files as rendered (`key-placement.ts`): the name of its module and declarations,
 * `<label>-<hash>` within `keys/`, the module, the declarations and their map, `<label>.d.ts.map`,
 * and the line of the declarations each key is on.
 */
type ShardFiles = {
	name: string;
	module: string;
	declarations: string;
	map: string;
	lines: readonly DeclarationLine[];
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
 * Renders the output: the modules beside the keys, as rendered, and the keys. Each key's module is its group's, when the saved groups hold it, else its
 * shard's, by a hash of its name, so a key stays in its place while others come and go
 * (`key-placement.ts`). Only the places whose keys changed are rendered again, and those that
 * import a module renamed: every place for the runtime, and for the plural rules or the formatters,
 * the places whose keys call them. Other groups place every key anew.
 */
export function renderOutput(
	config: Config,
	rendered: RenderedModules,
	compilation: Compilation<DeclaredKey>,
	base: BaseCatalog,
	groups: KeyGroups,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const { modules, moduleFiles } = rendered;
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
	const shardFiles = new Map<number, ShardFiles>();
	shards.forEach((keys, index) => {
		if (keys.length === 0) return;
		const previousFiles = before?.shardFiles.get(index);
		const shard =
			dirty.has(index) || previousFiles === undefined
				? renderShard(
						placement.label(index),
						keys,
						compilation,
						modules,
						config.locales,
					)
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
			...moduleFiles.immutable,
			...files.flatMap(({ name, module, declarations }): OutputFile[] => [
				[`keys/${name}.js`, module],
				[`keys/${name}.d.ts`, declarations],
			]),
		],
		mutable: [
			...moduleFiles.mutable,
			...[...shardFiles].map(
				([index, { map }]): OutputFile => [
					`keys/${placement.label(index)}.d.ts.map`,
					map,
				],
			),
			["keys.js", keysIndex],
			["keys.d.ts", keysIndex],
		],
	};
	return {
		output,
		rendered: {
			...rendered,
			files: new Map([...output.immutable, ...output.mutable]),
			groups: placement.groups,
			shards,
			shardFiles,
		},
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
 * A place's module and declarations, named by their content. They share the name so that
 * TypeScript reads the declarations rather than the module, as it does any `.js` beside its
 * `.d.ts`, and leaves the module out of a project that type-checks JavaScript; the declarations
 * name their map by the place's label.
 */
function renderShard(
	label: string,
	keys: readonly string[],
	compilation: Compilation<DeclaredKey>,
	modules: OutputModules,
	locales: readonly string[],
): Omit<ShardFiles, "map"> {
	const compiled = new Map<string, DeclaredKey>();
	for (const key of keys) {
		const compiledKey = compilation.keys.get(key);
		if (compiledKey !== undefined) compiled.set(key, compiledKey);
	}
	const module = shardModule([...compiled.values()], modules, locales);
	const { body, lines } = shardDeclarations(compiled, modules);
	const declarations = `${body}//# sourceMappingURL=${label}.d.ts.map\n`;
	const name = contentName(label, module, declarations);
	return { name, module, declarations, lines };
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

/** A shard's declarations, but the line naming their map, and the line each key's is on. */
function shardDeclarations(
	keys: ReadonlyMap<string, DeclaredKey>,
	modules: OutputModules,
): { body: string; lines: DeclarationLine[] } {
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
	return { body: parts.join(""), lines };
}
