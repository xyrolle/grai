/**
 * A project's code, read for a command: each source file under the roots, its facts from the cache
 * or read again, in the pool, and the module graph that follows their imports, resolved as the
 * project's bundler resolves them. A module the graph follows outside the sources, such as a
 * package's, is read when it is first followed.
 */

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Config } from "../config.ts";
import { GraiError } from "../error.ts";
import { keyModulePrefix } from "../locale-chunks.ts";
import { stateDirectory } from "../outdir-contents.ts";
import { keyOfModule, moduleOf } from "../output-paths.ts";
import { sourceExtensions, sourceFiles } from "../sources.ts";
import { type FileFacts, factsOf } from "./facts.ts";
import { FactsCache } from "./facts-cache.ts";
import { factsOfFiles } from "./facts-pool.ts";
import { ModuleGraph, type Output, type Resolve } from "./modules.ts";
import { projectResolve } from "./resolution.ts";

/** A source file: the path the project shows, its text, and its facts. */
export type SourceCode = { file: string; text: string; facts: FileFacts };

/** A project's sources, by path, and the graph of their modules. */
export type ProjectCode = {
	sources: ReadonlyMap<string, SourceCode>;
	graph: ModuleGraph;
};

/** A project's code under the roots, or the error that keeps its imports from resolving. */
export async function readProjectCode(
	config: Config,
	roots: readonly string[],
): Promise<ProjectCode | GraiError> {
	const output: Output = {
		messages: join(config.outdir, "messages.js"),
		keys: join(config.outdir, "keys.js"),
		keyOf: keyOfModule,
	};
	const resolveFile = await projectResolve(config.root);
	if (resolveFile instanceof GraiError) return resolveFile;
	// A key's path the app maps to keys.js is that key's own module, as a build resolves it.
	const resolve: Resolve = async (source, importer) => {
		const path = await resolveFile(source, importer);
		const module = moduleOf(source);
		return path === output.keys && module.type === "key"
			? `${keyModulePrefix}${module.key}`
			: path;
	};
	const cache = new FactsCache(join(config.outdir, stateDirectory));
	const files = sourceFiles(roots, config.root, config.outdir);
	const facts = files.map(({ path, text }) => cache.get(path, text));
	const unread = files.filter((_, index) => facts[index] === undefined);
	const read = await factsOfFiles(unread);
	unread.forEach(({ path, text }, index) => {
		const each = read[index];
		if (each !== undefined) cache.set(path, text, each);
	});
	saveQuietly(cache);
	const sources = new Map<string, SourceCode>();
	let next = 0;
	files.forEach(({ path, file, text }, index) => {
		const each = facts[index] ?? read[next++];
		if (each !== undefined) sources.set(path, { file, text, facts: each });
	});
	const followed = new Map<string, Promise<FileFacts | undefined>>();
	const factsOfPath = (path: string) => {
		const source = sources.get(path);
		if (source !== undefined) return Promise.resolve(source.facts);
		const known = followed.get(path);
		if (known !== undefined) return known;
		const facts = sourceExtensions.has(extname(path))
			? factsOf(path, readFileSync(path, "utf8"))
			: Promise.resolve(undefined);
		followed.set(path, facts);
		return facts;
	};
	return { sources, graph: new ModuleGraph(output, resolve, factsOfPath) };
}

/** Writes the cache; a cache that cannot be written only costs the next command its reading. */
function saveQuietly(cache: FactsCache): void {
	try {
		cache.save();
	} catch {
		// A read-only checkout keeps no cache.
	}
}
