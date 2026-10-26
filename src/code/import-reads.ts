/**
 * The reads a module's imports and re-exports make: a key's own path, read at the key's name in it;
 * a named import or re-export of a key; and an import of the output that nothing resolves, whose
 * reads are unknown. Each import's value is held by the name it binds, for its uses to follow.
 */

import { basename, dirname } from "node:path";
import { moduleOf } from "../output-paths.ts";
import {
	type Binding,
	type ImportFact,
	type ModuleFacts,
	type Span,
	usesFrom,
} from "./facts.ts";
import type { ModuleGraph, Value } from "./modules.ts";
import type { Edit } from "./reads.ts";
import { type Context, named, read } from "./use-reads.ts";

/** Reads a module's imports, and gives what each name an import binds holds. */
export async function readImports(
	context: Context,
	module: ModuleFacts,
): Promise<Map<string, Value>> {
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
		for (const name of fact.names) {
			const value = await graph.exported(target, name.imported, new Set());
			if (value === undefined) continue;
			held.set(name.local, value);
			if (value.kind !== "key" || pathKey !== undefined) continue;
			const place = { path, source, at: name.importedAt };
			reading.reads.push(
				read(place, {
					key: value.key,
					via: "name",
					edits: named(name.imported, value.key, name.importedAt),
					binding: bindingOf(module, name.local, name.at),
					type: fact.typeOnly,
				}),
			);
		}
		for (const reexport of fact.reexports) {
			const value = await graph.exported(target, reexport.imported, new Set());
			if (value?.kind !== "key") continue;
			const { importedAt, exportedAt } = reexport;
			const edits = named(reexport.imported, value.key, importedAt);
			if (exportedAt.start !== importedAt.start)
				edits.push(...named(reexport.exported, value.key, exportedAt));
			reading.reads.push(
				read(
					{ path, source, at: importedAt },
					{
						key: value.key,
						via: pathKey === undefined ? "name" : "module",
						edits,
						binding: undefined,
						type: fact.typeOnly,
					},
				),
			);
		}
	}
	return held;
}

/**
 * The read a key's path makes, at the key's name in it, with what an import of the key binds: a
 * static import, a re-export, or a load by its literal path, which its facts list as an import too.
 * It stands for the key's module whole in a report. A path written with escapes is written out
 * plainly by a rename, as only its value says where the key's name is.
 */
function readPath(
	{ path, source, reading }: Context,
	module: ModuleFacts,
	fact: ImportFact,
	key: string,
): void {
	const imported = fact.names.find((name) => name.imported === key);
	const literal = source.text.slice(fact.path.start, fact.path.end);
	const segment = fact.source.lastIndexOf("/") + 1;
	const plain = literal.slice(1, -1) === fact.source;
	const start = fact.path.start + 1 + segment;
	const at = plain ? { start, end: start + key.length } : fact.path;
	const edits: Edit[] = [
		plain
			? { at, before: "", after: "" }
			: {
					at,
					before: `${literal[0]}${fact.source.slice(0, segment)}`,
					after: `${fact.source.slice(segment + key.length)}${literal.at(-1)}`,
				},
	];
	if (imported !== undefined)
		edits.push(...named(key, key, imported.importedAt));
	reading.reads.push(
		read(
			{ path, source, at },
			{
				key,
				via: "path",
				edits,
				binding:
					imported === undefined
						? undefined
						: bindingOf(module, imported.local, imported.at),
				type: fact.typeOnly,
				written: fact.source,
			},
		),
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

/** What an import binds, with every reference to it. */
function bindingOf(module: ModuleFacts, local: string, at: Span): Binding {
	const references = usesFrom(module.uses, local).map(({ at, shorthand }) => ({
		at,
		shorthand,
	}));
	return { name: local, at, references };
}
