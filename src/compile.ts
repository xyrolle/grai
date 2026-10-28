import { createHash, hash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
	type RenderedModules,
	type RuntimeSources,
	renderModules,
} from "./output-modules.ts";
import { withPseudoLocale } from "./pseudo-locale.ts";
import { type Rendered, renderOutput } from "./render.ts";
import { type KeyGroups, savedGroups } from "./saved-groups.ts";

/** What a compile wrote, relative to the outdir, or every error found, sorted by file, key and locale. */
export type CompileResult = { written: string[]; errors: GraiError[] };

/**
 * A project compiled, its output not yet written: what it read, its keys compiled, and the output's
 * modules beside the keys rendered, which a dev server serves its first page from before it writes.
 */
export type Compiled = ParsedCatalogs & {
	config: Config;
	/** Each catalog file read, as `parts` has its catalog. */
	sources: readonly CatalogSource[];
	hashes: readonly string[];
	compilation: Compilation;
	rendered: RenderedModules;
	/** What a saved build must match to be taken up again: `buildKey` of the config as read. */
	key: string;
};

/** Everything a compile read, made and wrote, kept so the next compile redoes only what changed. */
export type Build = Compiled & {
	/** Where each key is in the base locale's catalog, for the declaration maps. */
	positions: ReadonlyMap<string, Position>;
	rendered: Rendered;
};

const text = (url: URL): string => readFileSync(url, "utf8");

/**
 * The runtime's modules, which every output carries, their imports of each other pinned, and the
 * templates of the output's declarations.
 */
const runtime: RuntimeSources = {
	runtime: text(new URL("./runtime/runtime.js", import.meta.url)),
	server: text(new URL("./runtime/server.js", import.meta.url)),
	testing: text(new URL("./runtime/testing.js", import.meta.url)),
	declarations: {
		runtime: text(new URL("./runtime/runtime.d.ts.template", import.meta.url)),
		server: text(new URL("./runtime/server.d.ts.template", import.meta.url)),
		testing: text(new URL("./runtime/testing.d.ts.template", import.meta.url)),
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

/**
 * The compiler's own modules, the runtime's among them, and the templates of the output's
 * declarations, hashed: what decides the output besides the config and the catalogs. A new version
 * of grai changes them, and so does a local build, which keeps its version, so the output is
 * written again after either. Taken on the first compile.
 */
let compilerHash: string | undefined;

function hashOfCompiler(): string {
	compilerHash ??= hashOfModules(fileURLToPath(new URL(".", import.meta.url)));
	return compilerHash;
}

function hashOfModules(directory: string): string {
	const modules = readdirSync(directory, { recursive: true, encoding: "utf8" })
		.filter(
			(file) =>
				(/\.(js|ts)$/.test(file) && !file.endsWith(".d.ts")) ||
				file.endsWith(".d.ts.template"),
		)
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
	const compiled = compiledFrom(read.config, read.sources, hashes);
	if ("errors" in compiled) return { written: [], errors: compiled.errors };
	const { result } = await writeBuild(compiled);
	return result;
}

/**
 * Whether the output is already that of the project's config and catalogs, which `compile` would
 * leave as it is. A project that cannot be read has no such output.
 */
export async function isCompiled(configFile: string): Promise<boolean> {
	const read = await readProject(configFile);
	if ("errors" in read) return false;
	return isUpToDate(
		read.config.outdir,
		inputsOf(
			read.config,
			hashesOf(read.sources),
			false,
			savedGroups(read.config.outdir),
		),
	);
}

function hashesOf(sources: readonly CatalogSource[]): string[] {
	return sources.map((source) => hash("sha1", source.bytes));
}

/**
 * How a compile is for: development and tests take the config's pseudo-locale, a build never. A
 * build that writes a copy of each message chunk per locale says so in config.js (`localeCopies`),
 * for the server that points pages at them.
 */
export type CompileOptions = { pseudoLocale?: boolean; localeCopies?: boolean };

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
	const compiled = await compileProject(configFile, previous, options);
	if ("errors" in compiled)
		return { result: { written: [], errors: compiled.errors } };
	return writeBuild(compiled, previous, options);
}

/**
 * The first half of `recompile`: compiles from `previous` as it does, and renders the modules
 * beside the keys, but neither renders the keys nor writes anything. `previous` may be a project
 * compiled so and not written yet. Returns every error found, or the project compiled, for
 * `writeBuild` to write.
 */
export async function compileProject(
	configFile: string,
	previous: Compiled | undefined,
	options: CompileOptions = {},
): Promise<Compiled | { errors: GraiError[] }> {
	const read = await readProject(configFile);
	if ("errors" in read) return read;
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
	return compiledFrom(read.config, read.sources, hashes, before, options);
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

/** Parses and compiles what was read, and renders the modules beside the keys, or returns every error. */
function compiledFrom(
	configured: Config,
	sources: readonly CatalogSource[],
	hashes: readonly string[],
	previous?: Compiled,
	{ pseudoLocale = false, localeCopies = false }: CompileOptions = {},
): Compiled | { errors: GraiError[] } {
	const parsed = parseCatalogs(sources, previous);
	if (parsed.errors.length > 0) return { errors: parsed.errors };
	const { config, catalogs } = pseudoLocale
		? withPseudoLocale(configured, parsed.catalogs, previous?.catalogs)
		: { config: configured, catalogs: parsed.catalogs };
	const compilation = compileCatalogs(config, catalogs, previous?.compilation);
	if (compilation.errors.length > 0) return { errors: [...compilation.errors] };
	return {
		config,
		sources,
		hashes,
		parts: parsed.parts,
		catalogs,
		compilation,
		rendered: renderModules(
			config,
			runtime,
			compilation,
			localeCopies,
			previous?.rendered.formats,
		),
		key: buildKey(configured, { pseudoLocale, localeCopies }),
	};
}

/**
 * The second half of `recompile`: renders a compiled project's keys, placed by the groups saved
 * for its outdir, and writes its output, every file of it the outdir lacks or holds otherwise.
 * `previous` is the build written last, which the project was compiled from: with the same config,
 * only what changed since is rendered again, and with none, or another config, everything is.
 * `localeCopies` is the compile's.
 */
export async function writeBuild(
	compiled: Compiled,
	previous?: Build,
	{ localeCopies = false }: CompileOptions = {},
): Promise<{ result: CompileResult; build?: Build }> {
	const { config, sources, parts, catalogs, compilation } = compiled;
	const before =
		previous !== undefined && sameConfig(previous.config, config)
			? previous
			: undefined;
	const groups = savedGroups(config.outdir);
	const baseIndex = config.locales.indexOf(config.baseLocale);
	const moved = basePositionsMoved(
		catalogs[baseIndex],
		before?.catalogs[baseIndex],
	);
	const positions =
		moved || before === undefined
			? basePositions(sources, parts, config.baseLocale)
			: before.positions;
	const { output, rendered } = renderOutput(
		config,
		compiled.rendered,
		compilation,
		{ paths: config.catalogs.get(config.baseLocale) ?? [], positions, moved },
		groups,
		before?.rendered,
	);
	let written: string[];
	try {
		written = await writeOutput(
			config.outdir,
			output,
			inputsOf(config, compiled.hashes, localeCopies, groups),
		);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { result: { written: [], errors: [error] } };
	}
	return {
		result: { written, errors: [] },
		build: { ...compiled, positions, rendered },
	};
}

/**
 * Parses every catalog file, taking from the previous build each one whose bytes are the same, and
 * makes each locale's catalog of its files', or returns every error. Without errors, `parts` are the
 * files' catalogs in the order of `sources`.
 */
export function parseCatalogs(
	sources: readonly CatalogSource[],
	previous?: Compiled,
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
	previous?: Compiled,
): Catalog {
	const old = previous?.sources[index];
	const catalog = previous?.parts[index];
	if (old === undefined || catalog === undefined) return parseCatalog(source);
	if (old.bytes.equals(source.bytes)) return catalog;
	return parseEditedCatalog(source, catalog, old.bytes);
}

/**
 * What decides the output: the compiler, whether its build writes the locale copies, the config,
 * every catalog's bytes, and the groups of keys saved for it. The whole config, as no field is then
 * left out by mistake: the catalogs' paths are in the declaration maps.
 */
function inputsOf(
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
