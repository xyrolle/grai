import { hash } from "node:crypto";
import { serialize } from "node:v8";
import { basePositions, basePositionsMoved } from "./base-positions.ts";
import {
	type Catalog,
	type CatalogSource,
	parseCatalog,
	parseEditedCatalog,
	readCatalogSources,
} from "./catalog.ts";
import { localeCatalogs, type ParsedCatalogs } from "./catalog-parts.ts";
import { type Compilation, compileCatalogs } from "./compilation.ts";
import { type Config, readConfig } from "./config.ts";
import type { Position } from "./declaration-maps.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isUpToDate, writeOutput } from "./output.ts";
import {
	hashesOf,
	hashOfCompiler,
	inputsOf,
	runtimeSources,
} from "./output-inputs.ts";
import { cameBy, type Placing } from "./placing.ts";
import { withPseudoLocale } from "./pseudo-locale.ts";
import { type Rendered, renderOutput } from "./render.ts";
import { type KeyGroups, savedGroups } from "./saved-groups.ts";

/** What a compile wrote, relative to the outdir, or every error found, sorted by file, key and locale. */
export type CompileResult = { written: string[]; errors: GraiError[] };

/** Everything a compile read and made, kept so the next compile redoes only what changed. */
export type Build = ParsedCatalogs & {
	config: Config;
	/** Each catalog file read, as `parts` has its catalog. */
	sources: readonly CatalogSource[];
	hashes: readonly string[];
	compilation: Compilation;
	/** Where each key is in the base locale's catalog, for the declaration maps. */
	positions: ReadonlyMap<string, Position>;
	rendered: Rendered;
	/** What a saved build must match to be taken up again: `buildKey` of the config as read. */
	key: string;
};

/**
 * Compiles a project's catalogs and writes its output, unless the output is already that of the
 * same config and catalogs. Never throws a `GraiError`: every one found is in the result.
 */
export async function compile(configFile: string): Promise<CompileResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return { written: [], errors: read.errors };
	const hashes = hashesOf(read.sources);
	const groups = savedGroups(read.config.outdir);
	if (
		await isUpToDate(
			read.config.outdir,
			inputsOf(read.config, hashes, false, groups),
		)
	) {
		return { written: [], errors: [] };
	}
	const { result } = await build(read.config, read.sources, hashes, groups);
	return result;
}

/**
 * How a compile is for: development and tests take the config's pseudo-locale, a build never. A
 * build that writes a copy of each message chunk per locale says so in config.js (`localeCopies`),
 * for the server that points pages at them. `placing`, when given, is asked once the catalogs are
 * compiled for groups to place the keys by in place of those saved (`placing.ts`).
 */
export type CompileOptions = {
	pseudoLocale?: boolean;
	localeCopies?: boolean;
	placing?: Placing | undefined;
};

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
	return build(
		read.config,
		read.sources,
		hashes,
		savedGroups(read.config.outdir),
		before,
		options,
	);
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
	groups: KeyGroups,
	previous?: Build,
	{ pseudoLocale = false, localeCopies = false, placing }: CompileOptions = {},
): Promise<{ result: CompileResult; build?: Build }> {
	const parsed = parseCatalogs(sources, previous);
	if (parsed.errors.length > 0) {
		return { result: { written: [], errors: parsed.errors } };
	}
	const { parts } = parsed;
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
			? basePositions(sources, parts, config.baseLocale)
			: previous.positions;
	const render = (by: KeyGroups, before: Rendered | undefined) =>
		renderOutput(
			config,
			runtimeSources(),
			compilation,
			{ paths: config.catalogs.get(config.baseLocale) ?? [], positions, moved },
			{ localeCopies, groups: by },
			before,
		);
	const asked = await placing?.(compilation);
	const early =
		asked &&
		(asked.waited
			? await asked.groups.catch(() => undefined)
			: await cameBy(asked.groups));
	let placement = early ?? groups;
	let { output, rendered } = render(placement, previous?.rendered);
	const late =
		asked && !asked.waited && early === undefined
			? await cameBy(asked.groups)
			: undefined;
	if (late !== undefined) {
		placement = late;
		({ output, rendered } = render(late, rendered));
	}
	let written: string[];
	try {
		written = await writeOutput(
			config.outdir,
			output,
			inputsOf(config, hashes, localeCopies, placement),
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
			parts,
			catalogs,
			compilation,
			positions,
			rendered,
			key: buildKey(configured, { pseudoLocale, localeCopies }),
		},
	};
}

/**
 * Parses every catalog file, taking from the previous build each one whose bytes are the same, and
 * makes each locale's catalog of its files', or returns every error. Without errors, `parts` are the
 * files' catalogs in the order of `sources`.
 */
export function parseCatalogs(
	sources: readonly CatalogSource[],
	previous?: Build,
): { parts: Catalog[]; catalogs: Catalog[]; errors: GraiError[] } {
	const errors: GraiError[] = [];
	const parsedParts = sources.map((source, index) => {
		try {
			return parsed(source, index, previous);
		} catch (error) {
			if (!(error instanceof GraiError)) throw error;
			errors.push(error);
			return undefined;
		}
	});
	const parts = parsedParts.filter((part) => part !== undefined);
	const joined = localeCatalogs(sources, parsedParts, previous);
	return {
		parts,
		catalogs: joined.catalogs,
		errors: sortErrors([...errors, ...joined.errors]),
	};
}

/** A catalog file parsed, or taken from the previous build when its bytes are the same. */
function parsed(
	source: CatalogSource,
	index: number,
	previous?: Build,
): Catalog {
	const old = previous?.sources[index];
	const catalog = previous?.parts[index];
	if (old === undefined || catalog === undefined) return parseCatalog(source);
	if (old.bytes.equals(source.bytes)) return catalog;
	return parseEditedCatalog(source, catalog, old.bytes);
}

/**
 * What a saved build must match to be taken up again (`savedBuild`): the compiler and the runtime
 * that made it, the config as read, and the options it was compiled with. The runtime names V8, in
 * whose format the build is saved, and ICU, whose plural rules and locale data the compile reads.
 */
export function buildKey(
	config: Config,
	{ pseudoLocale = false, localeCopies = false }: CompileOptions,
): string {
	return JSON.stringify({
		compiler: hashOfCompiler(),
		runtime: [process.versions.v8, process.versions.icu],
		options: { pseudoLocale, localeCopies },
		config: hash("sha1", serialize(config)),
	});
}
