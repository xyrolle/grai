import { add, type Bits, bits, has } from "./bits.ts";

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
 * Which entries reach each of `keys`, read from the module graph, or nothing when the graph cannot
 * tell them all. It tells a key's when its own module is imported by the modules that use it, as a
 * per-key path is. A key imported through `barrel` (keys.js, which re-exports every key) is reached
 * from wherever any key is, and a key's chunk depends on the others', so one such key leaves them all
 * to the entries' own sets.
 */
export function keyReach(
	graph: ModuleGraph,
	keys: Iterable<string>,
	barrel: string,
): KeyReach | undefined {
	const used = [...keys].flatMap((key) => {
		const module = graph(key);
		return module === null ? [] : [{ key, module }];
	});
	if (used.some(({ module }) => module.importers.includes(barrel)))
		return undefined;
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
