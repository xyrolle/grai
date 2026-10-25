import { createHash, hash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serialize } from "node:v8";
import {
	type Catalog,
	type CatalogSource,
	parseCatalog,
	parseEditedCatalog,
	readCatalogSources,
} from "./catalog.ts";
import { hasObjects } from "./catalog-keys.ts";
import { type Compilation, compileCatalogs } from "./compilation.ts";
import { type Config, readConfig } from "./config.ts";
import { keyPositions, type Position } from "./declaration-maps.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isUpToDate, writeOutput } from "./output.ts";
import { withPseudoLocale } from "./pseudo-locale.ts";
import { type Rendered, renderOutput } from "./render.ts";

/** What a compile wrote, relative to the outdir, or every error found, sorted by file, key and locale. */
export type CompileResult = { written: string[]; errors: GraiError[] };

/** Everything a compile read and made, kept so the next compile redoes only what changed. */
export type Build = {
	config: Config;
	sources: readonly CatalogSource[];
	hashes: readonly string[];
	catalogs: readonly Catalog[];
	compilation: Compilation;
	/** Where each key is in the base locale's catalog, for the declaration maps. */
	positions: ReadonlyMap<string, Position>;
	rendered: Rendered;
	/** What a saved build must match to be taken up again: `buildKey` of the config as read. */
	key: string;
	/**
	 * The output as the compile that made this build left it, so the next one writes only the files
	 * that differ; undefined for a build saved by an earlier process, whose output may have been
	 * written again since, so the next compile compares with the files themselves.
	 */
	written: ReadonlyMap<string, string> | undefined;
};

/** The runtime's modules, which every output carries as they are. */
const runtime = {
	runtime: readFileSync(
		new URL("./runtime/runtime.js", import.meta.url),
		"utf8",
	),
	server: readFileSync(new URL("./runtime/server.js", import.meta.url), "utf8"),
};

/**
 * The compiler's own modules, the runtime's among them, hashed: what decides the output besides the
 * config and the catalogs. A new version of grai changes them, and so does a local build, which
 * keeps its version, so the output is written again after either. Taken on the first compile.
 */
let compilerHash: string | undefined;

function hashOfCompiler(): string {
	compilerHash ??= hashOfModules(fileURLToPath(new URL(".", import.meta.url)));
	return compilerHash;
}

function hashOfModules(directory: string): string {
	const modules = readdirSync(directory, { recursive: true, encoding: "utf8" })
		.filter((file) => /\.(js|ts)$/.test(file) && !file.endsWith(".d.ts"))
		.sort();
	const digest = createHash("sha1");
	for (const file of modules) {
		digest.update(file).update(readFileSync(join(directory, file)));
	}
	return digest.digest("hex");
}

/**
 * Compiles a project's catalogs and writes its output, unless the output is already that of the
 * same config and catalogs. Never throws a `GraiError`: every one found is in the result.
 */
export async function compile(configFile: string): Promise<CompileResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return { written: [], errors: read.errors };
	const hashes = read.sources.map((source) => hash("sha1", source.bytes));
	if (await isUpToDate(read.config.outdir, inputsOf(read.config, hashes))) {
		return { written: [], errors: [] };
	}
	const { result } = await build(read.config, read.sources, hashes);
	return result;
}

/** How a compile is for: development and tests take the config's pseudo-locale, a build never. */
export type CompileOptions = { pseudoLocale?: boolean };

/**
 * Compiles again after an edit: reads the config and catalogs, parses only the catalogs that
 * changed (and of those, only the entries the edit touched), compiles only the keys that changed,
 * and writes only the files that changed. The build is undefined when the compile failed.
 */
export async function recompile(
	configFile: string,
	previous: Build | undefined,
	options: CompileOptions = {},
): Promise<{ result: CompileResult; build?: Build }> {
	const read = await readProject(configFile);
	if ("errors" in read) return { result: { written: [], errors: read.errors } };
	const before =
		previous !== undefined && sameConfig(previous.config, read.config)
			? previous
			: undefined;
	const hashes = read.sources.map((source, index) => {
		const old = before?.sources[index];
		const oldHash = before?.hashes[index];
		return old !== undefined &&
			oldHash !== undefined &&
			old.bytes.equals(source.bytes)
			? oldHash
			: hash("sha1", source.bytes);
	});
	return build(read.config, read.sources, hashes, before, options);
}

function sameConfig(a: Config, b: Config): boolean {
	const shape = (config: Config) =>
		JSON.stringify([
			[...config.catalogs],
			config.baseLocale,
			config.outdir,
			[...config.fallbacks],
		]);
	return shape(a) === shape(b);
}

/** Reads a project's config and every catalog file, or returns every error doing so. */
export async function readProject(
	configFile: string,
): Promise<
	{ config: Config; sources: CatalogSource[] } | { errors: GraiError[] }
> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return { errors: [error] };
		throw error;
	}
	const { sources, errors } = await readCatalogSources(config);
	return errors.length > 0
		? { errors: sortErrors(errors) }
		: { config, sources };
}

async function build(
	configured: Config,
	sources: readonly CatalogSource[],
	hashes: readonly string[],
	previous?: Build,
	{ pseudoLocale = false }: CompileOptions = {},
): Promise<{ result: CompileResult; build?: Build }> {
	const parsed = parseCatalogs(sources, previous);
	if (parsed.errors.length > 0) {
		return { result: { written: [], errors: parsed.errors } };
	}
	const { config, catalogs } = pseudoLocale
		? withPseudoLocale(configured, parsed.catalogs, previous?.catalogs)
		: { config: configured, catalogs: parsed.catalogs };
	const compilation = compileCatalogs(config, catalogs, previous?.compilation);
	if (compilation.errors.length > 0) {
		return { result: { written: [], errors: [...compilation.errors] } };
	}
	const baseIndex = config.locales.indexOf(config.baseLocale);
	const moved = basePositionsMoved(
		catalogs[baseIndex],
		previous?.catalogs[baseIndex],
	);
	const positions =
		moved || previous === undefined
			? keyPositions(
					sources[baseIndex]?.bytes.toString("utf8") ?? "",
					catalogs[baseIndex]?.messages.keys(),
					hasObjects(catalogs[baseIndex]?.paths.values() ?? []),
				)
			: previous.positions;
	const { output, rendered } = renderOutput(
		config,
		runtime,
		compilation,
		{ path: config.catalogs.get(config.baseLocale) ?? "", positions, moved },
		previous?.rendered,
	);
	let written: string[];
	try {
		written = await writeOutput(
			config.outdir,
			output,
			inputsOf(config, hashes),
			previous?.written,
		);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { result: { written: [], errors: [error] } };
	}
	return {
		result: { written, errors: [] },
		build: {
			config,
			sources,
			hashes,
			catalogs,
			compilation,
			positions,
			rendered,
			key: buildKey(configured, pseudoLocale),
			written: rendered.files,
		},
	};
}

/**
 * Parses every catalog, taking from the previous build each catalog whose bytes are the same, or
 * returns every catalog's error.
 */
export function parseCatalogs(
	sources: readonly CatalogSource[],
	previous?: Build,
): { catalogs: Catalog[]; errors: GraiError[] } {
	const catalogs: Catalog[] = [];
	const errors: GraiError[] = [];
	sources.forEach((source, index) => {
		try {
			catalogs.push(parsed(source, index, previous));
		} catch (error) {
			if (!(error instanceof GraiError)) throw error;
			errors.push(error);
		}
	});
	return { catalogs, errors: sortErrors(errors) };
}

/** A catalog parsed, or taken from the previous build when its bytes are the same. */
function parsed(
	source: CatalogSource,
	index: number,
	previous?: Build,
): Catalog {
	const old = previous?.sources[index];
	const catalog = previous?.catalogs[index];
	if (old === undefined || catalog === undefined) return parseCatalog(source);
	if (old.bytes.equals(source.bytes)) return catalog;
	return parseEditedCatalog(source, catalog, old.bytes);
}

/** Whether the base catalog's keys can start on other lines than in the previous build's. */
function basePositionsMoved(
	base: Catalog | undefined,
	previous: Catalog | undefined,
): boolean {
	if (base === previous) return false;
	return (
		base?.edit === undefined ||
		base.edit.from !== previous?.revision ||
		base.edit.moved
	);
}

/** What decides the output: the compiler, the config and every catalog's bytes. */
function inputsOf(config: Config, hashes: readonly string[]): string {
	return hash(
		"sha1",
		JSON.stringify([
			hashOfCompiler(),
			config.locales,
			config.baseLocale,
			config.strategy,
			config.cookie,
			config.urlRouting,
			[...config.fallbacks],
			hashes,
		]),
	);
}

/**
 * What a saved build must match to be taken up again (`savedBuild`): the compiler and the runtime
 * that made it, the config as read and whether it has the pseudo-locale. The runtime names V8, in
 * whose format the build is saved, and ICU, whose plural rules and locale data the compile reads.
 */
export function buildKey(config: Config, pseudoLocale: boolean): string {
	return JSON.stringify({
		compiler: hashOfCompiler(),
		runtime: [process.versions.v8, process.versions.icu],
		pseudoLocale,
		config: hash("sha1", serialize(config)),
	});
}
