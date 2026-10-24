import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	type Catalog,
	type CatalogSource,
	parseCatalog,
	readCatalogSources,
} from "./catalog.ts";
import { compileCatalogs } from "./compilation.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isUpToDate, writeOutput } from "./output.ts";
import { renderOutput } from "./render.ts";

/** What a compile wrote, relative to the outdir, or every error found, sorted by file, key and locale. */
export type CompileResult = { written: string[]; errors: GraiError[] };

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
	const { config, sources } = read;
	const inputs = inputsOf(
		config,
		sources.map((source) => hash("sha1", source.bytes)),
	);
	if (await isUpToDate(config.outdir, inputs)) {
		return { written: [], errors: [] };
	}
	const catalogs: Catalog[] = [];
	const errors: GraiError[] = [];
	for (const source of sources) {
		try {
			catalogs.push(parseCatalog(source));
		} catch (error) {
			if (!(error instanceof GraiError)) throw error;
			errors.push(error);
		}
	}
	if (errors.length > 0) return { written: [], errors: sortErrors(errors) };
	const compilation = compileCatalogs(config, catalogs);
	if (compilation.errors.length > 0) {
		return { written: [], errors: [...compilation.errors] };
	}
	const output = renderOutput(config, runtimeSource, compilation);
	try {
		return {
			written: await writeOutput(config.outdir, output, inputs),
			errors: [],
		};
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { written: [], errors: [error] };
	}
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

/** What decides the output: the compiler's runtime, the config and every catalog's bytes. */
function inputsOf(config: Config, hashes: readonly string[]): string {
	return hash(
		"sha1",
		JSON.stringify([runtimeHash, config.locales, config.baseLocale, hashes]),
	);
}
