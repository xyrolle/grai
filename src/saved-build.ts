import { renameSync, writeFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { Catalog } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import { type Build, buildKey, type CompileOptions } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { stateDirectory } from "./outdir-contents.ts";

/**
 * A build as saved: every field of it but its key, which heads the file, and of each catalog every
 * field but its revision and edit. A revision is a symbol of the process that parsed the catalog,
 * so the build taken up gives each catalog a new one, and the edit it came from is the past's. No
 * field is listed, so one a build gains is saved with the rest.
 */
type Saved = Omit<Build, "key" | "catalogs" | "compilation"> & {
	catalogs: readonly SavedCatalog[];
	compilation: Omit<Compilation, "catalogs"> & {
		catalogs: readonly SavedCatalog[];
	};
};
type SavedCatalog = Omit<Catalog, "revision" | "edit">;

/** The file of the saved build in the outdir's state: its key on the first line, then the build. */
const savedName = "build";

/**
 * Saves a build for the next process's first compile, as V8 serializes it, in a file beside the
 * manifest. The file is written whole and then renamed into place, so a reader sees one build or
 * another, never part of one, whichever process saved it last.
 */
export async function saveBuild(build: Build): Promise<void> {
	const { temporary, file, bytes } = savedFile(build);
	await writeFile(temporary, bytes);
	await rename(temporary, file);
}

/**
 * Saves a build as `saveBuild` does, synchronously, as the process exits and nothing waits for a
 * promise.
 */
export function saveBuildNow(build: Build): void {
	const { temporary, file, bytes } = savedFile(build);
	writeFileSync(temporary, bytes);
	renameSync(temporary, file);
}

/** A build's saved file: its bytes, its path, and the path it is written to first. */
function savedFile(build: Build): {
	temporary: string;
	file: string;
	bytes: Buffer;
} {
	const { key, catalogs: parsed, compilation, ...rest } = build;
	const catalogs = parsed.map(withoutRevision);
	const saved: Saved = {
		...rest,
		catalogs,
		compilation: { ...compilation, catalogs },
	};
	const state = join(build.config.outdir, stateDirectory);
	return {
		temporary: join(state, `${savedName}.${process.pid}.tmp`),
		file: join(state, savedName),
		bytes: Buffer.concat([Buffer.from(`${key}\n`), serialize(saved)]),
	};
}

/**
 * The build the last process saved for this config and options, by this grai on this runtime, or
 * undefined if there is none: a compile that starts from it compiles only what changed since, as
 * after an edit. Like every compile, it writes the files the outdir does not hold as it would.
 */
export async function savedBuild(
	configFile: string,
	options: CompileOptions,
): Promise<Build | undefined> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		// A config that does not read is the compile's to report.
		if (error instanceof GraiError) return undefined;
		throw error;
	}
	const key = buildKey(config, options);
	const saved = await readSaved(
		join(config.outdir, stateDirectory, savedName),
		key,
	);
	if (saved === undefined) return undefined;
	const catalogs = saved.catalogs.map(
		(catalog): Catalog => ({ ...catalog, revision: Symbol(catalog.locale) }),
	);
	return {
		...saved,
		catalogs,
		compilation: { ...saved.compilation, catalogs },
		key,
	};
}

/**
 * The build a file saved under this key, or undefined if it holds another key's or none. A saved
 * build only spares a compile, so a file that cannot be read, or that a crash cut short, is none.
 */
async function readSaved(
	file: string,
	key: string,
): Promise<Saved | undefined> {
	const header = Buffer.from(`${key}\n`);
	try {
		const bytes = await readFile(file);
		if (!bytes.subarray(0, header.length).equals(header)) return undefined;
		// The key names the grai that saved the build, so it is this module's `Saved`.
		return deserialize(bytes.subarray(header.length));
	} catch {
		return undefined;
	}
}

/** A catalog as saved: all of it but its revision and its edit, which are this process's. */
function withoutRevision({
	revision: _revision,
	edit: _edit,
	...catalog
}: Catalog): SavedCatalog {
	return catalog;
}
