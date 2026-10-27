import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { contentName } from "./content-names.ts";
import {
	type BaseCatalog,
	type DeclarationLine,
	shardMap,
} from "./declaration-maps.ts";
import { keyExports } from "./key-exports.ts";
import { placedKeys, placementOf, replaced } from "./key-placement.ts";
import { calledNames, everyName, outputImports } from "./output-imports.ts";
import {
	type OutputModules,
	type RenderedFormats,
	type RuntimeSources,
	renderModules,
} from "./output-modules.ts";
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

/** The output's files by path, the modules the keys import, and each place's keys and files. */
export type Rendered = {
	files: ReadonlyMap<string, string>;
	modules: OutputModules;
	/** formats.js, which the next render keeps if the messages call the same formatters. */
	formats: RenderedFormats;
	/** The groups the keys were placed by, as JSON. */
	groups: string;
	/** Each place's keys, sorted. */
	shards: readonly (readonly string[])[];
	/** The files of each place that holds keys, by its index. */
	shardFiles: ReadonlyMap<number, ShardFiles>;
};

/** The output's .gitignore: everything in it is compiled from the catalogs, so none of it is committed. */
const gitignore = "# grai writes this directory from the catalogs.\n*\n";

/** `m`, the namespace of keys.js, as messages.js and its declarations export it. */
const messagesModule = `export * as m from "./keys.js";\n`;

/**
 * The outdir's package.json. Its modules are ES modules whatever the project's package.json says,
 * and only server.js, which binds the request's store as it loads, has effects of its own: a bundler
 * that reads `sideEffects` then leaves out each module of keys no code reads, as `next dev` does in
 * each of its layers, and keeps a module whose keys are read whole, its check among them.
 */
const outdirPackage = `${JSON.stringify({ type: "module", sideEffects: ["./server.js"] }, null, "\t")}\n`;

/**
 * Renders the output. Each key's module is its group's, when the saved groups hold it, else its
 * shard's, by a hash of its name, so a key stays in its place while others come and go
 * (`key-placement.ts`). Only the places whose keys changed are rendered again, and those that
 * import a module renamed: every place for the runtime, and for the plural rules or the formatters,
 * the places whose keys call them. Other groups place every key anew.
 */
export function renderOutput(
	config: Config,
	runtime: RuntimeSources,
	compilation: Compilation,
	base: BaseCatalog,
	{ localeCopies, groups }: { localeCopies: boolean; groups: KeyGroups },
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const { modules, immutable, entries, formats } = renderModules(
		config,
		runtime,
		compilation,
		localeCopies,
		previous?.formats,
	);
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
			...immutable,
			...files.flatMap(({ name, module, declarations }): OutputFile[] => [
				[`keys/${name}.js`, module],
				[`keys/${name}.d.ts`, declarations],
			]),
		],
		mutable: [
			[".gitignore", gitignore],
			["package.json", outdirPackage],
			...[...shardFiles].map(
				([index, { map }]): OutputFile => [
					`keys/${placement.label(index)}.d.ts.map`,
					map,
				],
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
			formats,
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
	compilation: Compilation,
	modules: OutputModules,
	locales: readonly string[],
): Omit<ShardFiles, "map"> {
	const compiled = new Map<string, CompiledKey>();
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
