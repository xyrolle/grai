/**
 * What a name a module imports is, followed through the module graph the way the bundler binds it:
 * grai's namespace (`m`), a key's function, a module's namespace object, or none of grai's. A name
 * is followed through each module that exports it again: `export { m } from`, an import exported
 * again, a `const` that holds one, `export * as`, a default export, and `export *`, where a name a
 * module exports itself wins over a star export of the same name.
 */

import type { FileFacts, ModuleFacts } from "./facts.ts";

/** What a value is, as far as grai's output goes. */
export type Value =
	| { kind: "namespace" }
	| { kind: "key"; key: string }
	| { kind: "module"; path: string };

/** grai's output's modules, by their resolved paths, and how a build names a key's own module. */
export type Output = {
	messages: string;
	keys: string;
	/** The key whose own module a path is, as a build resolves a key's path to one, or undefined. */
	keyOf: (path: string) => string | undefined;
};

/** Where an import's path resolves from the importing file, or undefined when it names no file. */
export type Resolve = (
	source: string,
	importer: string,
) => Promise<string | undefined>;

/** A module's facts, by its path, or undefined for one that is not code grai reads. */
export type FactsOf = (path: string) => Promise<FileFacts | undefined>;

export class ModuleGraph {
	private readonly output: Output;
	private readonly resolve: Resolve;
	private readonly facts: FactsOf;
	private readonly exportsMemo = new Map<string, Promise<Value | undefined>>();

	constructor(output: Output, resolve: Resolve, facts: FactsOf) {
		this.output = output;
		this.resolve = resolve;
		this.facts = facts;
	}

	/** What `name` (`*` for the namespace object) imported from `source` in `importer` is. */
	async imported(
		importer: string,
		source: string,
		name: string,
	): Promise<Value | undefined> {
		const path = await this.resolve(source, importer);
		return path === undefined
			? undefined
			: this.exported(path, name, new Set());
	}

	/** What a value read by `name` from another is: a module object's export, or a namespace's key. */
	async member(value: Value, name: string): Promise<Value | undefined> {
		if (value.kind === "module")
			return this.exported(value.path, name, new Set());
		return value.kind === "namespace" ? { kind: "key", key: name } : undefined;
	}

	/** What a module exports by `name`, followed to where it is declared. */
	exported(
		path: string,
		name: string,
		seen: ReadonlySet<string>,
	): Promise<Value | undefined> {
		const id = `${path}\0${name}`;
		if (seen.has(id)) return Promise.resolve(undefined);
		const memo = this.exportsMemo.get(id);
		if (memo !== undefined) return memo;
		const value = this.follow(path, name, new Set([...seen, id]));
		this.exportsMemo.set(id, value);
		return value;
	}

	private async follow(
		path: string,
		name: string,
		seen: ReadonlySet<string>,
	): Promise<Value | undefined> {
		const own = this.outputExport(path, name);
		if (own !== "app") return own;
		if (name === "*") return { kind: "module", path };
		const facts = await this.facts(path);
		if (facts === undefined || "error" in facts) return undefined;
		for (const module of facts.modules) {
			const value = await this.explicit(path, module, name, seen);
			if (value !== "none") return value;
		}
		if (name === "default") return undefined;
		for (const module of facts.modules) {
			for (const fact of module.exports) {
				if (!("source" in fact) || fact.exported !== undefined) continue;
				const target = await this.resolve(fact.source, path);
				const value =
					target === undefined
						? undefined
						: await this.exported(target, name, seen);
				if (value !== undefined) return value;
			}
		}
		return undefined;
	}

	/** What grai's output exports by a name, or `"app"` for a module of the app's. */
	private outputExport(path: string, name: string): Value | undefined | "app" {
		const { messages, keys, keyOf } = this.output;
		if (path === keys) {
			return name === "*" ? { kind: "namespace" } : { kind: "key", key: name };
		}
		if (path === messages) {
			if (name === "*") return { kind: "module", path };
			return name === "m" ? { kind: "namespace" } : undefined;
		}
		const key = keyOf(path);
		if (key === undefined) return "app";
		if (name === "*") return { kind: "module", path };
		return name === key ? { kind: "key", key } : undefined;
	}

	/**
	 * What a module's own export of `name` is: one of its imports, a `const` that holds one, or
	 * another module's export; undefined for a value of its own; `"none"` when it exports no such name.
	 */
	private async explicit(
		path: string,
		module: ModuleFacts,
		name: string,
		seen: ReadonlySet<string>,
	): Promise<Value | undefined | "none"> {
		for (const fact of module.exports) {
			if (fact.exported !== name) continue;
			if ("source" in fact) {
				const target = await this.resolve(fact.source, path);
				return target === undefined
					? undefined
					: this.exported(target, fact.imported, seen);
			}
			const local = module.aliases[fact.local] ?? fact.local;
			for (const { source, names } of module.imports) {
				const imported = names.find((each) => each.local === local);
				if (imported === undefined) continue;
				const target = await this.resolve(source, path);
				return target === undefined
					? undefined
					: this.exported(target, imported.imported, seen);
			}
			return undefined;
		}
		return "none";
	}
}
