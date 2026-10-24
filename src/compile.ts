import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	type Catalog,
	type CatalogSource,
	parseCatalog,
	parseEditedCatalog,
	readCatalogSources,
} from "./catalog.ts";
import { type Compilation, compileCatalogs } from "./compilation.ts";
import { type Config, readConfig } from "./config.ts";
import { keyPositions, type Position } from "./declaration-maps.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isUpToDate, writeOutput } from "./output.ts";
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
};

/** The runtime's modules, which every output carries as they are. */
const runtime = {
	runtime: readFileSync(
		new URL("./runtime/runtime.js", import.meta.url),
		"utf8",
	),
	server: readFileSync(new URL("./runtime/server.js", import.meta.url), "utf8"),
};
const runtimeHash = hash("sha1", runtime.runtime + runtime.server);

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

/**
 * Compiles again after an edit: reads the config and catalogs, parses only the catalogs that
 * changed (and of those, only the entries the edit touched), compiles only the keys that changed,
 * and writes only the files that changed. The build is undefined when the compile failed.
 */
export async function recompile(
	configFile: string,
	previous: Build | undefined,
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
	return build(read.config, read.sources, hashes, before);
}

function sameConfig(a: Config, b: Config): boolean {
	const shape = (config: Config) =>
		JSON.stringify([[...config.catalogs], config.baseLocale, config.outdir]);
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
	config: Config,
	sources: readonly CatalogSource[],
	hashes: readonly string[],
	previous?: Build,
): Promise<{ result: CompileResult; build?: Build }> {
	const { catalogs, errors } = parseCatalogs(sources, previous);
	if (errors.length > 0) return { result: { written: [], errors } };
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
			previous?.rendered.files,
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
		base?.edit === undefined || base.edit.from !== previous || base.edit.moved
	);
}

/** What decides the output: the compiler's runtime, the config and every catalog's bytes. */
function inputsOf(config: Config, hashes: readonly string[]): string {
	return hash(
		"sha1",
		JSON.stringify([
			runtimeHash,
			config.locales,
			config.baseLocale,
			config.strategy,
			config.cookieName,
			hashes,
		]),
	);
}
