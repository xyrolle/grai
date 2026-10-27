/**
 * The reads of grai's messages a project's code makes, from its files' facts and its module graph:
 * each key read by name, at the place its name is, and each read that may reach more keys than one,
 * a computed read, a use of the namespace whole or a load by a pattern of paths, with the keys it may
 * reach. What a command does with them is the command's: check reports, `--fix` removes, rename edits.
 */

import { basename, dirname } from "node:path";
import { moduleOf } from "../output-paths.ts";
import {
	type Binding,
	type ImportFact,
	type ModuleFacts,
	originOf,
	type Span,
	usesFrom,
} from "./facts.ts";
import type { ModuleGraph, Value } from "./modules.ts";
import type { ProjectCode, SourceCode } from "./project.ts";
import { reachOfPattern } from "./reach.ts";
import { type Context, reachAt, read, readUse } from "./use-reads.ts";

/** Where a read is: the file, by its path and as the project shows it, its text, and the span. */
export type Place = { path: string; source: SourceCode; at: Span };

/**
 * A key read by name: through the namespace (`m.key`, `m["key"]`, a pattern taking it apart),
 * through a key's own path, or by the name an import of it binds. `binding` is what a pattern or a
 * key's import binds, with every reference to it.
 */
export type Read = Place & {
	key: string;
	written: string;
	type: boolean;
	via: "member" | "pattern" | "name" | "path" | "binding";
	binding: Binding | undefined;
};

/**
 * A read that may reach more keys than it names: every key that starts with `prefix`, or one of
 * `choices` when it is a choice between literals or a module object that holds those keys.
 */
export type Reach = Place & {
	written: string;
	prefix: string;
	choices: string[] | undefined;
	type: boolean;
};

/** A file whose code does not parse, with the parser's message at its place. */
export type Unreadable = Place & { message: string };

/** An import whose path is one of grai's output's, but which nothing the project declares resolves. */
export type Unresolved = Place & { specifier: string };

/** A static import of names from keys.js itself, `import { title } from "./out/keys.js"`, at its path. */
export type KeysImport = Place & { fact: ImportFact };

export type Reading = {
	reads: Read[];
	reaches: Reach[];
	unreadable: Unreadable[];
	unresolved: Unresolved[];
	keysImports: KeysImport[];
};

/** Every read of a project's code. */
export async function readingOf(code: ProjectCode): Promise<Reading> {
	const reading: Reading = {
		reads: [],
		reaches: [],
		unreadable: [],
		unresolved: [],
		keysImports: [],
	};
	for (const [path, source] of code.sources) {
		const { facts } = source;
		if ("error" in facts) {
			const { at, message } = facts.error;
			const place = { path, source, at: { start: at, end: at } };
			reading.unreadable.push({ ...place, message });
			continue;
		}
		for (const module of facts.modules) {
			await readModule({ path, source, graph: code.graph, reading }, module);
		}
	}
	// A `const` that holds a key read (`const t = m.title`) reads it once, however often it is used.
	const places = new Set<string>();
	reading.reads = reading.reads.filter(({ path, at, key }) => {
		const place = `${path}\0${at.start}\0${key}`;
		const first = !places.has(place);
		places.add(place);
		return first;
	});
	return reading;
}

async function readModule(
	context: Context,
	module: ModuleFacts,
): Promise<void> {
	const { path, source, graph, reading } = context;
	const held = new Map<string, Value>();
	for (const fact of module.imports) {
		const target = await graph.resolve(fact.source, path);
		if (target === undefined) {
			// Named no file, it names none of grai's, unless its path is one of the output's: then
			// what it reads is unknown, as the bundler would fail it too.
			if (isOutputPath(fact.source, graph)) {
				const place = { path, source, at: fact.path };
				reading.unresolved.push({ ...place, specifier: fact.source });
			}
			continue;
		}
		const pathKey = graph.output.keyOf(target);
		if (pathKey !== undefined) readPath(context, module, fact, pathKey);
		// A re-export or a load lists no names.
		if (target === graph.output.keys && fact.names.length > 0) {
			reading.keysImports.push({ path, source, at: fact.path, fact });
		}
		for (const name of fact.names) {
			const value = await graph.exported(target, name.imported);
			if (value === undefined) continue;
			held.set(name.local, value);
			if (value.kind !== "key" || pathKey !== undefined) continue;
			const binding = bindingOf(module, name.local, name.at);
			const place = { path, source, at: name.at };
			reading.reads.push(
				read(place, value.key, "name", binding, fact.typeOnly),
			);
		}
	}
	const loads: (Value | undefined)[] = [];
	for (const load of module.loads) {
		if ("source" in load) {
			const target = await graph.resolve(load.source, path);
			loads.push(
				target === undefined ? undefined : await graph.exported(target, "*"),
			);
			continue;
		}
		const reach = await reachOfPattern(graph, load.pattern, path);
		if (reach !== undefined) {
			reading.reaches.push(
				reachAt({ path, source, at: load.at }, reach, false),
			);
		}
		loads.push(undefined);
	}
	// Only the uses that start from what holds grai's are read, so only theirs are parsed.
	for (const [local, origin] of held) {
		for (const use of usesFrom(module.uses, local)) {
			await readUse(context, use, origin);
		}
	}
	for (const [load, origin] of loads.entries()) {
		if (origin === undefined) continue;
		for (const use of usesFrom(module.uses, originOf({ load }))) {
			await readUse(context, use, origin);
		}
	}
}

/**
 * The read a key's path makes, at the key's name in it, with what an import of the key binds: a
 * static import, a re-export, or a load by its literal path, which its facts list as an import too.
 * It stands for the key's module whole, so what code then reads of that module is no other read.
 */
function readPath(
	{ path, source, reading }: Context,
	module: ModuleFacts,
	fact: ImportFact,
	key: string,
): void {
	const named = fact.names.find(({ imported }) => imported === key);
	const binding =
		named === undefined ? undefined : bindingOf(module, named.local, named.at);
	const literal = source.text.slice(fact.path.start, fact.path.end);
	const start = fact.path.start + literal.lastIndexOf("/") + 1;
	const place = { path, source, at: { start, end: start + key.length } };
	reading.reads.push(
		read(place, key, "path", binding, fact.typeOnly, fact.source),
	);
}

/**
 * Whether a path is one of the output's by how it is written: messages.js or keys.js in the
 * outdir's directory, `…/out/messages.js`, or a key's path, `…/messages/<key>.js`.
 */
function isOutputPath(specifier: string, graph: ModuleGraph): boolean {
	const module = moduleOf(specifier);
	if (module.type === "key") return true;
	if (module.type === "other") return false;
	const outdir = basename(dirname(graph.output.messages));
	return specifier.split("/").at(-2) === outdir;
}

/** What an import of a key binds, with every reference to it, for a rename of the key's name. */
function bindingOf(module: ModuleFacts, local: string, at: Span): Binding {
	const references = usesFrom(module.uses, local).map((use) => use.at);
	return { name: local, at, references };
}
