/**
 * What decides a project's output, and whether its outdir holds that output already: what every
 * compile writes in the manifest (`compile.ts`), and the check `next dev` runs on Next's own thread
 * before Next may start (`next/config.ts`), apart from the compiler's modules, which that check
 * then need not load.
 */

import { hash } from "node:crypto";
import { join } from "node:path";
import { type CatalogSource, readCatalogSources } from "./catalog.ts";
import { hashOfCompiler } from "./compiler-identity.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { readManifest } from "./manifest.ts";
import { isUpToDate } from "./output.ts";
import { type KeyGroups, savedGroups } from "./saved-groups.ts";
import { stateDirectory } from "./state-directory.ts";

/** Each catalog file's hash. */
export function hashesOf(sources: readonly CatalogSource[]): string[] {
	return sources.map((source) => hash("sha1", source.bytes));
}

/**
 * What decides the output: the compiler, whether its build writes the locale copies, the config,
 * every catalog's bytes, the groups of keys saved for it, and whether it holds the keys'
 * declarations, as every output does once written whole. The whole config, as no field is then left
 * out by mistake: the catalogs' paths are in the declaration maps. An output written without its
 * declarations (`writeUndeclared`) is so never taken for the whole one, and a start after one that
 * stopped before writing them writes them.
 */
export function inputsOf(
	config: Config,
	hashes: readonly string[],
	localeCopies: boolean,
	groups: KeyGroups,
	declared = true,
): string {
	return hash(
		"sha1",
		JSON.stringify(
			[hashOfCompiler(), localeCopies, config, hashes, groups, declared],
			collectionsAsLists,
		),
	);
}

/** JSON of a config's maps and sets, as lists of their entries. */
function collectionsAsLists(_key: string, value: unknown): unknown {
	return value instanceof Map || value instanceof Set ? [...value] : value;
}

/**
 * Whether the output is already that of the project's config and catalogs, which a compile would
 * leave as it is. A project that cannot be read has no such output, and nor has an outdir without a
 * manifest, as a fresh clone's: the catalogs are then not read.
 */
export async function isCompiled(configFile: string): Promise<boolean> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return false;
		throw error;
	}
	if ((await readManifest(join(config.outdir, stateDirectory))) === undefined)
		return false;
	const { sources, errors } = await readCatalogSources(config);
	if (errors.length > 0) return false;
	return isUpToDate(
		config.outdir,
		inputsOf(config, hashesOf(sources), false, savedGroups(config.outdir)),
	);
}
