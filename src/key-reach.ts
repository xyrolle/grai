import { add, type Bits, bits, has } from "./bits.ts";
import { keyModulePrefix } from "./locale-chunks.ts";

/** What the bundler tells of a module, as much as a key's reach needs. */
export type GraphModule = {
	readonly importers: readonly string[];
	readonly importedIds: readonly string[];
	readonly dynamicImporters: readonly string[];
	readonly isEntry: boolean;
};

/** The bundler's module graph: a module's links, or `null` for a module it does not hold. */
export type ModuleGraph = (id: string) => GraphModule | null;

/**
 * The entries each key module is reached from by static imports, as indices into `entries`, the
 * user's entries and the targets of dynamic imports among the keys' importers.
 */
export type KeyReach = {
	readonly entries: readonly string[];
	/** Whether each entry is one of the user's, rather than only a dynamic import's target. */
	readonly user: readonly boolean[];
	/** Each key the graph holds, with its entries. */
	readonly of: ReadonlyMap<string, Bits>;
};

/**
 * How a build's modules link beyond its graph: the keys each module reads through grai's
 * namespace, the modules that read it by a computed name, which may be any key, and the imports of
 * the modules whose imports change once re-export modules are seen through (`module-links.ts`).
 */
export type KeyLinks = {
	readonly reads: ReadonlyMap<string, ReadonlySet<string>>;
	readonly computed: ReadonlySet<string>;
	readonly imports: ReadonlyMap<string, readonly string[]>;
};

/**
 * Which entries reach each of `keys`, read from the module graph as `links` amends it. A key is
 * reached from the modules that import its own module, as a per-key path is, and from those that
 * read it through the namespace. `barrel`, keys.js, re-exports every key, so it links to none: a
 * module that only imports it reaches no key through it.
 */
export function keyReach(
	bundled: ModuleGraph,
	keys: readonly string[],
	barrel: string,
	links: KeyLinks,
): KeyReach {
	const graph = asRead(bundled, keys, barrel, links);
	const used = keys.flatMap((key) => {
		const module = graph(key);
		return module === null ? [] : [{ key, module }];
	});
	const cone = upward(
		graph,
		used.map(({ key }) => key),
	);
	const entries = [...cone.keys()].filter((id) => {
		const module = cone.get(id);
		return (
			module !== undefined &&
			(module.isEntry || module.dynamicImporters.length > 0)
		);
	});
	const reach = downward(cone, entries);
	return {
		entries,
		user: entries.map((id) => cone.get(id)?.isEntry === true),
		of: new Map(
			used.map(({ key }) => [key, reach.get(key) ?? bits(entries.length)]),
		),
	};
}

/**
 * The graph as `links` amends it: a module that reads keys through the namespace imports each of
 * those keys' modules, one that reads it by a computed name imports every key's, a module whose
 * imports change once re-export modules are seen through imports what it does then, and keys.js
 * imports no key.
 */
function asRead(
	graph: ModuleGraph,
	keys: readonly string[],
	barrel: string,
	{ reads, computed, imports }: KeyLinks,
): ModuleGraph {
	const every = keys.filter((id) => id.startsWith(keyModulePrefix));
	const importsOf = (id: string, module: GraphModule) => {
		if (id === barrel) return [];
		const read = computed.has(id)
			? every
			: [...(reads.get(id) ?? [])].map((key) => `${keyModulePrefix}${key}`);
		const own = imports.get(id) ?? module.importedIds;
		return read.length === 0 ? own : [...own, ...read];
	};
	const importers = new Map<string, Set<string>>();
	const link = (from: string, to: string) => {
		const found = importers.get(to);
		if (found === undefined) importers.set(to, new Set([from]));
		else found.add(from);
	};
	for (const [reader, read] of reads)
		for (const key of read) link(reader, `${keyModulePrefix}${key}`);
	for (const reader of computed) for (const key of every) link(reader, key);
	for (const [importer, own] of imports)
		for (const id of own) link(importer, id);
	const changed = new Map(
		[...imports].map(([importer, own]) => [importer, new Set(own)]),
	);
	return (id) => {
		const module = graph(id);
		if (module === null) return null;
		const linked = importers.get(id) ?? new Set();
		const kept = module.importers.filter(
			(importer) =>
				importer !== barrel && (changed.get(importer)?.has(id) ?? true),
		);
		return {
			isEntry: module.isEntry,
			dynamicImporters: module.dynamicImporters,
			importers: [...new Set([...kept, ...linked])],
			importedIds: importsOf(id, module),
		};
	};
}

/** The modules `keys` are statically imported from, transitively, keys included. */
function upward(
	graph: ModuleGraph,
	keys: readonly string[],
): Map<string, GraphModule> {
	const cone = new Map<string, GraphModule>();
	const pending = [...keys];
	for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
		if (cone.has(id)) continue;
		const module = graph(id);
		if (module === null) continue;
		cone.set(id, module);
		pending.push(...module.importers);
	}
	return cone;
}

/**
 * Each module of the cone with the entries it is statically imported from: each entry marks its
 * static imports once, its bit doubling as the mark of a module it has reached.
 */
function downward(
	cone: ReadonlyMap<string, GraphModule>,
	entries: readonly string[],
): Map<string, Bits> {
	const reach = new Map<string, Bits>();
	const of = (id: string) => {
		const found = reach.get(id) ?? bits(entries.length);
		reach.set(id, found);
		return found;
	};
	entries.forEach((entry, index) => {
		const pending = [entry];
		for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
			const reached = of(id);
			if (has(reached, index)) continue;
			add(reached, index);
			for (const imported of cone.get(id)?.importedIds ?? []) {
				if (cone.has(imported)) pending.push(imported);
			}
		}
	});
	return reach;
}
