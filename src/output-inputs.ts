/**
 * What decides a project's output, and whether its outdir holds that output already: what every
 * compile writes in the manifest (`compile.ts`), and the check `next dev` runs on Next's own thread
 * before Next may start (`next/config.ts`), apart from the compiler's modules, which that check
 * then need not load.
 */

import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CatalogSource, readCatalogSources } from "./catalog.ts";
import { compilerIdentity } from "./compiler-identity.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { readManifest } from "./manifest.ts";
import { isUpToDate } from "./output.ts";
import type { RuntimeSources } from "./output-modules.ts";
import { type KeyGroups, savedGroups } from "./saved-groups.ts";
import { stateDirectory } from "./state-directory.ts";

const text = (url: URL): string => readFileSync(url, "utf8");

/**
 * The runtime's modules, which every output carries, their imports of each other pinned, and the
 * templates of the output's declarations; read once.
 */
let runtime: RuntimeSources | undefined;

export function runtimeSources(): RuntimeSources {
	runtime ??= {
		runtime: text(new URL("./runtime/runtime.js", import.meta.url)),
		server: text(new URL("./runtime/server.js", import.meta.url)),
		testing: text(new URL("./runtime/testing.js", import.meta.url)),
		declarations: {
			runtime: text(
				new URL("./runtime/runtime.d.ts.template", import.meta.url),
			),
			server: text(new URL("./runtime/server.d.ts.template", import.meta.url)),
			testing: text(
				new URL("./runtime/testing.d.ts.template", import.meta.url),
			),
			setLocale: {
				live: text(
					new URL("./runtime/set-locale.live.d.ts.template", import.meta.url),
				),
				reload: text(
					new URL("./runtime/set-locale.reload.d.ts.template", import.meta.url),
				),
			},
		},
	};
	return runtime;
}

/**
 * The compiler's identity (`compilerIdentity`): what decides the output besides the config and the
 * catalogs. A new version of grai changes it, and so does a local build, which keeps its version,
 * so the output is written again after either. Taken once.
 */
let compilerHash: string | undefined;

export function hashOfCompiler(): string {
	const sources = runtimeSources();
	compilerHash ??= compilerIdentity([
		sources.runtime,
		sources.server,
		sources.testing,
		sources.declarations.runtime,
		sources.declarations.server,
		sources.declarations.testing,
		sources.declarations.setLocale.live,
		sources.declarations.setLocale.reload,
	]);
	return compilerHash;
}

/** Each catalog file's hash. */
export function hashesOf(sources: readonly CatalogSource[]): string[] {
	return sources.map((source) => hash("sha1", source.bytes));
}

/**
 * What decides the output: the compiler, whether its build writes the locale copies, the config,
 * every catalog's bytes, and the groups of keys saved for it. The whole config, as no field is then
 * left out by mistake: the catalogs' paths are in the declaration maps.
 */
export function inputsOf(
	config: Config,
	hashes: readonly string[],
	localeCopies: boolean,
	groups: KeyGroups,
): string {
	return hash(
		"sha1",
		JSON.stringify(
			[hashOfCompiler(), localeCopies, config, hashes, groups],
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
