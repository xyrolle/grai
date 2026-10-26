/**
 * The reads of grai's messages a project's code makes, from its files' facts and its module graph:
 * each key read by name, at the place its name is, and each read that may reach more keys than one,
 * a computed read, a use of the namespace whole or a load by a pattern of paths, with the keys it may
 * reach. What a command does with them is the command's: check reports, `--fix` removes, `find`
 * lists, `rename` edits.
 */

import {
	type Binding,
	type ModuleFacts,
	originOf,
	type Span,
	usesFrom,
} from "./facts.ts";
import { readImports } from "./import-reads.ts";
import type { Value } from "./modules.ts";
import type { ProjectCode, SourceCode } from "./project.ts";
import { reachOfPattern } from "./reach.ts";
import { type Context, reachAt, readUse } from "./use-reads.ts";

/** Where a read is: the file, by its path and as the project shows it, its text, and the span. */
export type Place = { path: string; source: SourceCode; at: Span };

/** A change of a key's name in the file: the text at `at` becomes `before`, the new name, `after`. */
export type Edit = { at: Span; before: string; after: string };

/**
 * A key read by name: through the namespace (`m.key`, `m["key"]`, a pattern taking it apart), a
 * named import or re-export, a key's own path, or a read off the key's own module (`module`),
 * which its path's read stands for in a report. `edits` are where the code spells the key's name,
 * which a rename changes; a name another module gives the key (`export { title as heading }`) is
 * that module's, and none. `binding` is what the read binds, with every reference to it.
 */
export type Read = Place & {
	key: string;
	written: string;
	type: boolean;
	via: "member" | "pattern" | "name" | "path" | "module";
	edits: Edit[];
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
	const held = await readImports(context, module);
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
			const place = { path, source, at: load.at };
			reading.reaches.push(reachAt(place, reach, false));
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
