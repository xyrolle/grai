/**
 * A project's code, read for a command: each source file under the roots, its facts from the cache
 * or read again, and the module graph that follows their imports, resolved as the project's bundler
 * resolves them. The sources' imports are resolved up front, both in the pool. A module the graph
 * follows outside the sources, such as a package's, is read and resolved when it is first followed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { Config } from "../config.ts";
import { GraiError } from "../error.ts";
import { keyModulePrefix } from "../locale-chunks.ts";
import { keyOfModule, moduleOf } from "../output-paths.ts";
import { realPath } from "../real-path.ts";
import { type Seen, sourceExtensions } from "../sources.ts";
import { stateDirectory } from "../state-directory.ts";
import { type FileFacts, factsOf } from "./facts.ts";
import { FactsCache } from "./facts-cache.ts";
import { factsOfSources } from "./facts-pool.ts";
import { barrelsOf, holding } from "./holders.ts";
import { Installed } from "./installed.ts";
import { FileListing } from "./listing.ts";
import { keyPathPatterns, projectMappings } from "./mappings.ts";
import { ModuleGraph, type Output, type Resolve } from "./modules.ts";
import { Pool } from "./pool.ts";
import { projectResolution, resolverFor } from "./resolution.ts";
import { Resolutions, unnamed } from "./resolved.ts";
import { type StateStore, stateFiles } from "./state-store.ts";
import { TextTest } from "./text-test.ts";
import { workspacePackages } from "./workspace.ts";

/** A source file: the path the project shows, its text, and its facts. */
export type SourceCode = { file: string; text: string; facts: FileFacts };

/**
 * A project's sources, by path, the graph of their modules, and the package.json `imports`
 * patterns that give each key its own path (`#i18n/messages/*`).
 */
export type ProjectCode = {
	sources: ReadonlyMap<string, SourceCode>;
	graph: ModuleGraph;
	keyPaths: readonly string[];
};

/**
 * Which files a reading parses: those whose text may name grai's output, or with a key only what
 * may read or reach that key (`keyNamesOf`), for a command about it alone; or, `every`, each source
 * under the roots with every import resolved, for a reading that follows the app's module graph
 * from its entries, through modules that hold nothing of grai's.
 */
export type ReadingScope = { key?: string | undefined; every?: boolean };

/**
 * A project's code under the roots, or the error that keeps its imports from resolving. It keeps
 * the facts and the listing it read for the next reading in `store`: the outdir's state, unless
 * given another.
 */
export async function readProjectCode(
	given: Config,
	roots: readonly string[],
	{
		key,
		every = false,
		store,
	}: ReadingScope & { store?: StateStore | undefined } = {},
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
		keyOf: keyOfModule,
	};
	const resolution = await projectResolution(config.root);
	if (resolution instanceof GraiError) return resolution;
	const resolveFile = resolverFor(resolution);
	const state = join(config.outdir, stateDirectory);
	const kept = store ?? stateFiles(state);
	const cache = new FactsCache(kept);
	const seen: Seen = { links: [], manifests: [], skipped: [] };
	const listedRoots = roots.map(realPath);
	const listing = new FileListing(kept, cache.version);
	const files = await listing.list(
		listedRoots,
		config.root,
		config.outdir,
		seen,
	);
	const listed = new Set(files.map(({ path }) => path));
	const sources = new Map<string, SourceCode>();
	const pool = new Pool();
	const resolutions = new Resolutions(resolution, resolveFile, pool);
	// A key's path the app maps to keys.js is that key's own module, as a build resolves it.
	const resolve: Resolve = async (source, importer) => {
		const path = resolutions.path(source, importer);
		const module = moduleOf(source);
		return path === output.keys && module.type === "key"
			? `${keyModulePrefix}${module.key}`
			: path;
	};
	const followed = new Map<string, Promise<FileFacts | undefined>>();
	const factsOfPath = (path: string) => {
		const source = sources.get(path);
		if (source !== undefined) return Promise.resolve(source.facts);
		// A source its text leaves out of the reading holds nothing of grai's, and nor does a module an
		// import names without what holds it.
		if (listed.has(path) || path.startsWith(unnamed)) {
			return Promise.resolve(holdsNothing);
		}
		const known = followed.get(path);
		if (known !== undefined) return known;
		const facts = sourceExtensions.has(extname(path))
			? factsOf(path, readFileSync(path, "utf8"))
			: Promise.resolve(undefined);
		followed.set(path, facts);
		return facts;
	};
	const manifest = join(config.root, "package.json");
	const manifests = [
		...(existsSync(manifest) ? [manifest] : []),
		...seen.manifests.filter((each) => each !== manifest),
	];
	const mappings = projectMappings(resolution, manifests);
	const links = seen.links.map((path) => ({ path, real: realPath(path) }));
	const packages = workspacePackages(config.root);
	try {
		// The files whose text may name the output, a barrel or a module outside the listed sources,
		// read and resolved, until the barrels they hold and the packages the rest import name no file
		// more.
		const test = new TextTest({
			root: config.root,
			output,
			key,
			listing: {
				roots: listedRoots,
				skipped: seen.skipped,
				outdir: config.outdir,
			},
			mappings,
			links,
			packages,
			entries: new Set(manifests.map(dirname)),
		});
		const installed = new Installed(
			config.root,
			seen.skipped,
			mappings ?? [],
			resolveFile,
		);
		const wanted = (source: string, importer: string) =>
			every || test.leads(source, importer) || installed.imports(source);
		let barrels = new Set<string>();
		let reached = new Set<string>();
		for (let round = 0; ; round += 1) {
			const left = files.filter(({ path }) => !sources.has(path));
			const taken = every ? left : test.taken(left, barrels, reached);
			// The imports of the files read that the names found since may name.
			const again = round > 0 && (await resolutions.again(wanted));
			// The first round goes on with no file to read, to find the packages the files may import.
			if (taken.length === 0 && !again && round > 0) break;
			const read = await factsOfSources(taken, cache, pool);
			const added = new Map<string, SourceCode>();
			taken.forEach((each, index) => {
				const facts = read[index];
				if (facts === undefined) return;
				// The text is read when the reading asks for it, as the listing keeps its hash.
				added.set(each.path, {
					file: each.file,
					facts,
					get text() {
						return each.text;
					},
				});
			});
			for (const [path, source] of added) sources.set(path, source);
			await resolutions.add(added, wanted);
			const holds = holding(new ModuleGraph(output, resolve, factsOfPath), key);
			barrels = await barrelsOf(sources.keys(), holds);
			// The installed packages the sources left out may import, and that pass grai's on.
			if (mappings !== undefined) {
				const rest = files.filter(({ path }) => !sources.has(path));
				reached = await installed.passing(rest, holds);
			}
		}
		cache.keepUnread(listedRoots, listed);
		saveQuietly(() => cache.save());
		saveQuietly(() => listing.save());
	} finally {
		await pool.close();
	}
	return {
		sources,
		graph: new ModuleGraph(output, resolve, factsOfPath),
		keyPaths: keyPathPatterns(manifests, output.keys),
	};
}

/** The facts of a source the reading leaves out: none, as it holds nothing of grai's. */
const holdsNothing: FileFacts = { modules: [] };

/** Writes what a command keeps; what cannot be written only costs the next command its reading. */
function saveQuietly(save: () => void): void {
	try {
		save();
	} catch {
		// A read-only checkout keeps no cache.
	}
}
