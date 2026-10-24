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
	rendered: Rendered;
};

const runtimeSource = readFileSync(
	new URL("./runtime/runtime.js", import.meta.url),
	"utf8",
);
const runtimeHash = hash("sha1", runtimeSource);

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

async function readProject(
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
	if (errors.length > 0) {
		return { result: { written: [], errors: sortErrors(errors) } };
	}
	const compilation = compileCatalogs(config, catalogs, previous?.compilation);
	if (compilation.errors.length > 0) {
		return { result: { written: [], errors: [...compilation.errors] } };
	}
	const { output, rendered } = renderOutput(
		config,
		runtimeSource,
		compilation,
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
		build: { config, sources, hashes, catalogs, compilation, rendered },
	};
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

/** What decides the output: the compiler's runtime, the config and every catalog's bytes. */
function inputsOf(config: Config, hashes: readonly string[]): string {
	return hash(
		"sha1",
		JSON.stringify([runtimeHash, config.locales, config.baseLocale, hashes]),
	);
}
