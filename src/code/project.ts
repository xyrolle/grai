/**
 * A project's code, read for a command: each source file under the roots, its facts from the cache
 * or read again, and the module graph that follows their imports, resolved as the project's bundler
 * resolves them. The sources' imports are resolved up front, both in the pool. A module the graph
 * follows outside the sources, such as a package's, is read and resolved when it is first followed.
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Config } from "../config.ts";
import { GraiError } from "../error.ts";
import { keyModulePrefix } from "../locale-chunks.ts";
import { stateDirectory } from "../outdir-contents.ts";
import { moduleOf } from "../output-paths.ts";
import { realPath } from "../real-path.ts";
import { type Seen, sourceExtensions, sourceFiles } from "../sources.ts";
import { namesOf, textTest } from "./candidates.ts";
import { type FileFacts, factsOf } from "./facts.ts";
import { FactsCache } from "./facts-cache.ts";
import { factsOfSources } from "./facts-pool.ts";
import { projectMappings } from "./mappings.ts";
import { ModuleGraph, type Output, type Resolve } from "./modules.ts";
import { Pool } from "./pool.ts";
import { projectResolution, resolverFor } from "./resolution.ts";
import { importKey, resolvedImports } from "./resolved.ts";
import { OutsidePackages, workspacePackages } from "./workspace.ts";

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
	const seen: Seen = { links: [], manifests: [] };
	const files = sourceFiles(
		roots.map(realPath),
		config.root,
		config.outdir,
		seen,
	);
	const listed = new Set(files.map(({ path }) => path));
	const sources = new Map<string, SourceCode>();
	const resolved = new Map<string, string | undefined>();
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
		// A source its text leaves out of the reading holds nothing of grai's.
		if (listed.has(path)) return Promise.resolve(holdsNothing);
		const known = followed.get(path);
		if (known !== undefined) return known;
		const facts = sourceExtensions.has(extname(path))
			? factsOf(path, readFileSync(path, "utf8"))
			: Promise.resolve(undefined);
		followed.set(path, facts);
		return facts;
	};
	const manifest = join(config.root, "package.json");
	const mappings = projectMappings(resolution, [
		...(existsSync(manifest) ? [manifest] : []),
		...seen.manifests.filter((each) => each !== manifest),
	]);
	const links = seen.links.map((path) => ({ path, real: realPath(path) }));
	const packages = workspacePackages(config.root);
	const pool = new Pool();
	try {
		// The files whose text may name the output or a barrel, read and resolved, until the barrels
		// they hold name no file more.
		const outside = new OutsidePackages(packages, config.root);
		let barrels = new Set<string>();
		for (;;) {
			const names =
				mappings &&
				namesOf({ outdir: config.outdir, barrels }, mappings, links, packages);
			if (names !== undefined) {
				for (const name of outside.passing(names)) names.add(name);
			}
			const test = names && textTest(names);
			const taken = files.filter(
				({ path, text }) => !sources.has(path) && (test?.test(text) ?? true),
			);
			if (taken.length === 0) break;
			const read = await factsOfSources(taken, cache, pool);
			const added = new Map<string, SourceCode>();
			taken.forEach(({ path, file, text }, index) => {
				const facts = read[index];
				if (facts !== undefined) added.set(path, { file, text, facts });
			});
			for (const [path, source] of added) sources.set(path, source);
			const paths = await resolvedImports(added, resolution, resolveFile, pool);
			for (const [key, path] of paths) resolved.set(key, path);
			barrels = await barrelsOf(
				sources.keys(),
				new ModuleGraph(output, resolve, factsOfPath),
			);
		}
		saveQuietly(cache);
	} finally {
		await pool.close();
	}
	return { sources, graph: new ModuleGraph(output, resolve, factsOfPath) };
}

/** The facts of a source the reading leaves out: none, as it holds nothing of grai's. */
const holdsNothing: FileFacts = { modules: [] };

/** The sources that pass grai's on: each whose module holds a key or more. */
async function barrelsOf(
	paths: Iterable<string>,
	graph: ModuleGraph,
): Promise<Set<string>> {
	const barrels = new Set<string>();
	for (const path of paths) {
		const held = await graph.keysHeld({ kind: "module", path });
		if (held === "every" || held.size > 0) barrels.add(path);
	}
	return barrels;
}

/** Writes the cache; a cache that cannot be written only costs the next command its reading. */
function saveQuietly(cache: FactsCache): void {
	try {
		cache.save();
	} catch {
		// A read-only checkout keeps no cache.
	}
}
