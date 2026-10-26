/**
 * A project's code, read for a command: each source file under the roots, its facts from the cache
 * or read again, and the module graph that follows their imports, resolved as the project's bundler
 * resolves them. The sources' imports are resolved up front, both in the pool. A module the graph
 * follows outside the sources, such as a package's, is read and resolved when it is first followed.
 */

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Config } from "../config.ts";
import { GraiError } from "../error.ts";
import { keyModulePrefix } from "../locale-chunks.ts";
import { stateDirectory } from "../outdir-contents.ts";
import { moduleOf } from "../output-paths.ts";
import { realPath } from "../real-path.ts";
import { sourceExtensions, sourceFiles } from "../sources.ts";
import { type FileFacts, factsOf } from "./facts.ts";
import { FactsCache, textHash } from "./facts-cache.ts";
import { factsOfFiles } from "./facts-pool.ts";
import { ModuleGraph, type Output, type Resolve } from "./modules.ts";
import { Pool } from "./pool.ts";
import { projectResolution, resolverFor } from "./resolution.ts";
import { importKey, resolvedImports } from "./resolved.ts";

/** A source file: the path the project shows, its text, and its facts. */
export type SourceCode = { file: string; text: string; facts: FileFacts };

/** A project's sources, by path, and the graph of their modules. */
export type ProjectCode = {
	sources: ReadonlyMap<string, SourceCode>;
	graph: ModuleGraph;
};

/** A project's code under the roots, or the error that keeps its imports from resolving. */
export async function readProjectCode(
	given: Config,
	roots: readonly string[],
): Promise<ProjectCode | GraiError> {
	// Each module named by its real path, as the bundler names it and the resolver resolves it, so a
	// project reached through a symlink, as macOS reaches its temporary directory, finds its sources
	// and its output at the paths its imports resolve to.
	const config = {
		...given,
		root: realPath(given.root),
		outdir: realPath(given.outdir),
	};
	const output: Output = {
		messages: join(config.outdir, "messages.js"),
		keys: join(config.outdir, "keys.js"),
		keyOf: (path) =>
			path.startsWith(keyModulePrefix)
				? path.slice(keyModulePrefix.length)
				: undefined,
	};
	const resolution = await projectResolution(config.root);
	if (resolution instanceof GraiError) return resolution;
	const resolveFile = resolverFor(resolution);
	const cache = new FactsCache(join(config.outdir, stateDirectory));
	const files = sourceFiles(roots.map(realPath), config.root, config.outdir);
	// Each file's facts from the cache, or the file to read, by its text's hash.
	const cached: (FileFacts | undefined)[] = [];
	const unread: { path: string; text: string; hash: string }[] = [];
	for (const { path, text } of files) {
		const hash = textHash(text);
		const facts = cache.get(path, hash);
		cached.push(facts);
		if (facts === undefined) unread.push({ path, text, hash });
	}
	const pool = new Pool();
	const sources = new Map<string, SourceCode>();
	let resolved: ReadonlyMap<string, string | undefined>;
	try {
		const read = await factsOfFiles(unread, pool);
		unread.forEach(({ path, hash }, index) => {
			const each = read[index];
			if (each !== undefined) cache.set(path, hash, each);
		});
		saveQuietly(cache);
		let next = 0;
		files.forEach(({ path, file, text }, index) => {
			const each = cached[index] ?? read[next++]?.facts;
			if (each !== undefined) sources.set(path, { file, text, facts: each });
		});
		resolved = await resolvedImports(sources, resolution, resolveFile, pool);
	} finally {
		await pool.close();
	}
	// A key's path the app maps to keys.js is that key's own module, as a build resolves it.
	const resolve: Resolve = async (source, importer) => {
		const key = importKey(source, importer);
		const path = resolved.has(key)
			? resolved.get(key)
			: resolveFile(source, importer);
		const module = moduleOf(source);
		return path === output.keys && module.type === "key"
			? `${keyModulePrefix}${module.key}`
			: path;
	};
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
