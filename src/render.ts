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
 * `<label>-<hash>` within `keys/`, the module and the declarations, each with the hash of its text,
 * their map, `<label>.d.ts.map`, and the line of the declarations each key is on.
 */
type ShardFiles = {
	name: string;
	module: string;
	moduleHash: string;
	declarations: string;
	declarationsHash: string;
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
		immutable: moduleFiles.immutable,
		keyModules: files.flatMap((shard): OutputFile[] => [
			[`keys/${shard.name}.js`, shard.module, shard.moduleHash],
			[`keys/${shard.name}.d.ts`, shard.declarations, shard.declarationsHash],
		]),
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
			files: textsByPath(output.immutable, output.keyModules, output.mutable),
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
 * A place's module and declarations, named by their shape: the keys they declare, and the head of
 * each, which names what they import and the locales they were compiled for. An edit that changes
 * only messages keeps the name, so the compile replaces the two files in place, each renamed over
 * the old one at once, and the entries that name them stay as they are: a bundler watching the
 * outdir then compiles that module again and nothing else. A change of shape renames them, and
 * keys.js with them, so a reader loads one compile's layout. They share the name so that
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
	const types = shardDeclarations(compiled, modules);
	const declarations = `${types.head}${types.body}//# sourceMappingURL=${label}.d.ts.map\n`;
	const name = contentName(
		label,
		module.head,
		types.head,
		[...compiled.keys()].join("\n"),
	);
	const text = `${module.head}${module.body}`;
	return {
		name,
		module: text,
		moduleHash: hash("sha1", text),
		declarations,
		declarationsHash: hash("sha1", declarations),
		lines: types.lines,
	};
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
 * A shard's declarations: their head, which imports the types they name, and their body, but the
 * line naming their map, with the line each key's is on.
 */
function shardDeclarations(
	keys: ReadonlyMap<string, DeclaredKey>,
	modules: OutputModules,
): { head: string; body: string; lines: DeclarationLine[] } {
	const types = [...keys.values()].some((key) => key.markup)
		? "MarkupMessage, Message"
		: "Message";
	const parts: string[] = [];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const [name, key] of keys) {
		line += key.declared.lines;
		lines.push([name, line - 1]);
		parts.push(key.declared.text);
	}
	return {
		head: `import type { ${types} } from "../${modules.runtime}";\n\n`,
		body: parts.join(""),
		lines,
	};
}
