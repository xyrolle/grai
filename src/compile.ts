import { hash, randomUUID } from "node:crypto";
import { basePositions, basePositionsMoved } from "./base-positions.ts";
import { buildKey } from "./build-key.ts";
import {
	type Catalog,
	type CatalogSource,
	parseCatalog,
	parseEditedCatalog,
	readCatalogSources,
} from "./catalog.ts";
import { localeCatalogs, type ParsedCatalogs } from "./catalog-parts.ts";
import { type Compilation, compileCatalogs } from "./compilation.ts";
import { hashOfCompiler, runtimeSources } from "./compiler-identity.ts";
import { type Config, readConfig } from "./config.ts";
import type { Position } from "./declaration-maps.ts";
import { GraiError, sortErrors } from "./error.ts";
import { type DeclaredKey, declareKeys } from "./key-declarations.ts";
import { isUpToDate, type Publication, writeOutput } from "./output.ts";
import { hashesOf, inputsOf } from "./output-inputs.ts";
import { type RenderedModules, renderModules } from "./output-modules.ts";
import { cameBy, type Placing } from "./placing.ts";
import { withPseudoLocale } from "./pseudo-locale.ts";
import {
	type Output,
	type Rendered,
	renderOutput,
	renderUndeclared,
} from "./render.ts";
import { type KeyGroups, savedGroups, saveGroups } from "./saved-groups.ts";

/** What a compile wrote, relative to the outdir, or every error found, sorted by file, key and locale. */
export type CompileResult = { written: string[]; errors: GraiError[] };

/**
 * A project compiled, its output not yet written: what it read, its keys compiled, and the output's
 * modules beside the keys rendered, which a dev server serves its first page from before it writes.
 */
export type CompiledProject = ParsedCatalogs & {
	config: Config;
	/** Each catalog file read, as `parts` has its catalog. */
	sources: readonly CatalogSource[];
	hashes: readonly string[];
	compilation: Compilation;
	rendered: RenderedModules;
	/**
	 * What a saved build must match to be taken up again: `buildKey` of the config as read, made
	 * when it is first asked for, as the build is saved, with the compiler's identity taken as the
	 * project was compiled (`compileProject`).
	 */
	key: () => string;
};

/** Everything a compile read, made and wrote, kept so the next compile redoes only what changed. */
export type Build = Omit<CompiledProject, "compilation" | "rendered"> & {
	/** Every key compiled and declared. */
	compilation: Compilation<DeclaredKey>;
	/** Where each key is in the base locale's catalog, for the declaration maps. */
	positions: ReadonlyMap<string, Position>;
	rendered: Rendered;
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
	const compiled = compiledFrom(read.config, read.sources, hashes);
	if ("errors" in compiled) return { written: [], errors: compiled.errors };
	const { result } = await writeBuild(compiled);
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
	const compiled = await compileProject(configFile, previous, options);
	if ("errors" in compiled)
		return { result: { written: [], errors: compiled.errors } };
	return writeBuild(compiled, previous, options);
}

/**
 * The first half of `recompile`: compiles from `previous` as it does, and renders the modules
 * beside the keys, but neither renders the keys nor writes anything. `previous` may be a project
 * compiled so and not written yet. With `declare` false, the keys are left undeclared for
 * `writeBuild` to declare (`compileCatalogs`). Returns every error found, or the project compiled,
 * for `writeBuild` to write.
 */
export async function compileProject(
	configFile: string,
	previous: CompiledProject | undefined,
	options: CompileOptions & { declare?: boolean } = {},
): Promise<CompiledProject | { errors: GraiError[] }> {
	const reading = readProject(configFile);
	// The compiler's identity, taken while the catalogs are read and before anything is compiled: a
	// build saved later is this process's compiler's, whatever changes on disk meanwhile.
	hashOfCompiler();
	const read = await reading;
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
	previous?: CompiledProject,
	{
		pseudoLocale = false,
		localeCopies = false,
		declare = true,
	}: CompileOptions & { declare?: boolean } = {},
): CompiledProject | { errors: GraiError[] } {
	const parsed = parseCatalogs(sources, previous);
	if (parsed.errors.length > 0) return { errors: parsed.errors };
	const { config, catalogs } = pseudoLocale
		? withPseudoLocale(configured, parsed.catalogs, previous?.catalogs)
		: { config: configured, catalogs: parsed.catalogs };
	const compilation = compileCatalogs(config, catalogs, previous?.compilation, {
		declare,
	});
	if (compilation.errors.length > 0) return { errors: [...compilation.errors] };
	let key: string | undefined;
	return {
		config,
		sources,
		hashes,
		parts: parsed.parts,
		catalogs,
		compilation,
		rendered: renderModules(
			config,
			runtimeSources(),
			compilation,
			localeCopies,
			previous?.rendered.formats,
		),
		key: () => {
			key ??= buildKey(configured, { pseudoLocale, localeCopies });
			return key;
		},
	};
}

/**
 * An output written without its keys' declarations (`writeUndeclared`): the groups its keys were
 * placed by, and its render, which the write of the rest keeps.
 */
export type Undeclared = { id: string; groups: KeyGroups; rendered: Rendered };

/**
 * The second half of `recompile`: declares the keys its compile left undeclared (`declareKeys`),
 * renders a compiled project's keys, placed by the groups saved for its outdir, and writes its
 * output, every file of it the outdir lacks or holds otherwise. `previous` is the build written
 * last, which the project was compiled from: with the same config, only what changed since is
 * rendered again, and with none, or another config, everything is. `localeCopies` is the compile's.
 * With `undeclared`, the project's output written already without its declarations, the keys are
 * placed as they were then, and only the declarations and their maps are rendered and written.
 */
export async function writeBuild(
	compiled: CompiledProject,
	previous?: Build,
	{
		localeCopies = false,
		placing,
		undeclared,
	}: CompileOptions & { undeclared?: Undeclared | undefined } = {},
): Promise<{ result: CompileResult; build?: Build }> {
	const { config, sources, parts, catalogs } = compiled;
	const compilation = declareKeys(config, compiled.compilation);
	if (compilation.errors.length > 0)
		return { result: { written: [], errors: [...compilation.errors] } };
	const before =
		previous !== undefined && sameConfig(previous.config, config)
			? previous
			: undefined;
	const baseIndex = config.locales.indexOf(config.baseLocale);
	const moved = basePositionsMoved(
		catalogs[baseIndex],
		before?.catalogs[baseIndex],
	);
	const positions =
		moved || before === undefined
			? basePositions(sources, parts, config.baseLocale)
			: before.positions;
	const saved = undeclared?.groups ?? savedGroups(config.outdir);
	const { output, rendered, placement } = await placedRender(
		compilation,
		saved,
		undeclared === undefined ? placing : undefined,
		(by, last) =>
			renderOutput(
				config,
				compiled.rendered,
				compilation,
				{
					paths: config.catalogs.get(config.baseLocale) ?? [],
					positions,
					moved,
				},
				by,
				last,
			),
		undeclared?.rendered ?? before?.rendered,
	);
	const written = await published(
		config.outdir,
		output,
		inputsOf(config, compiled.hashes, localeCopies, placement),
		placement !== saved ? placement : undefined,
		{},
	);
	if (written instanceof GraiError)
		return { result: { written: [], errors: [written] } };
	return {
		result: { written, errors: [] },
		build: { ...compiled, compilation, positions, rendered },
	};
}

/**
 * Writes a compiled project's output without its keys' declarations, left undeclared by its
 * compile (`compileProject` with `declare` false), as a dev server that reads the output from the
 * disk needs only its modules before its first page: every module, whole, and none of the
 * declarations or their maps. The manifest records it as so written, by an id of its own
 * (`Publication`), and no check takes it for the output of its config and catalogs until
 * `writeBuild`, given what this returns, has declared the keys and written the rest, which names
 * the modules alike (`renderUndeclared`).
 */
export async function writeUndeclared(
	compiled: CompiledProject,
	{ localeCopies = false, placing }: CompileOptions = {},
): Promise<{ result: CompileResult; undeclared?: Undeclared }> {
	const { config } = compiled;
	const saved = savedGroups(config.outdir);
	const { output, rendered, placement } = await placedRender(
		compiled.compilation,
		saved,
		placing,
		(by, last) =>
			renderUndeclared(
				config,
				compiled.rendered,
				compiled.compilation,
				by,
				last,
			),
		undefined,
	);
	const id = randomUUID();
	const done = await published(
		config.outdir,
		output,
		inputsOf(config, compiled.hashes, localeCopies, placement),
		placement !== saved ? placement : undefined,
		{ undeclared: id },
	);
	if (done instanceof GraiError)
		return { result: { written: [], errors: [done] } };
	return {
		result: { written: done, errors: [] },
		undeclared: { id, groups: placement, rendered },
	};
}

/**
 * The output rendered by the groups `placing` gives, if they come in time (`placing.ts`), else by
 * those saved, and the groups it was placed by.
 */
async function placedRender(
	compilation: Compilation,
	saved: KeyGroups,
	placing: Placing | undefined,
	render: (
		by: KeyGroups,
		last: Rendered | undefined,
	) => { output: Output; rendered: Rendered },
	before: Rendered | undefined,
): Promise<{ output: Output; rendered: Rendered; placement: KeyGroups }> {
	const asked = await placing?.(compilation);
	const early =
		asked &&
		(asked.waited
			? await asked.groups.catch(() => undefined)
			: await cameBy(asked.groups));
	const placement = early ?? saved;
	const first = render(placement, before);
	const late =
		asked && !asked.waited && early === undefined
			? await cameBy(asked.groups)
			: undefined;
	if (late === undefined) return { ...first, placement };
	return { ...render(late, first.rendered), placement: late };
}

/**
 * Writes the output, and gives the files written, or the error the outdir gave; then saves the
 * groups `placing` gave, if the output was placed by them. They are the outdir's once that output is
 * written, and not before: only a write of grai's own output, which refuses an outdir another tool
 * fills, makes the state directory (`assertOutdirIsGrais`).
 */
async function published(
	outdir: string,
	output: Output,
	inputs: string,
	given: KeyGroups | undefined,
	publication: Publication,
): Promise<string[] | GraiError> {
	let written: string[];
	try {
		written = await writeOutput(outdir, output, inputs, publication);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return error;
	}
	if (given !== undefined) await saveGroups(outdir, given);
	return written;
}

/**
 * Parses every catalog file, taking from the previous build each one whose bytes are the same, and
 * makes each locale's catalog of its files', or returns every error. Without errors, `parts` are the
 * files' catalogs in the order of `sources`.
 */
export function parseCatalogs(
	sources: readonly CatalogSource[],
	previous?: CompiledProject,
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
	previous?: CompiledProject,
): Catalog {
	const old = previous?.sources[index];
	const catalog = previous?.parts[index];
	if (old === undefined || catalog === undefined) return parseCatalog(source);
	if (old.bytes.equals(source.bytes)) return catalog;
	return parseEditedCatalog(source, catalog, old.bytes);
}
