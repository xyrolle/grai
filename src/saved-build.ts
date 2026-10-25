import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { Catalog } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import { type Build, buildKey } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { stateDirectory } from "./output.ts";

/**
 * A build as saved. A catalog's revision is a symbol of the process that parsed it, so the build
 * taken up gives each catalog a new one, and the edit it came from is the past's.
 */
type Saved = Omit<Build, "key" | "written" | "catalogs" | "compilation"> & {
	catalogs: readonly SavedCatalog[];
	compilation: Omit<Compilation, "catalogs">;
};
type SavedCatalog = Omit<Catalog, "revision" | "edit">;

/** The file of the saved build in the outdir's state: its key on the first line, then the build. */
const savedFile = "build";

/**
 * How long after a watcher's first build it is saved. Serializing app A's build (6,379 keys × 3,
 * 22 MB) takes about 20 ms, which would otherwise hold up the start's first page.
 */
const saveMilliseconds = 1000;

/**
 * Saves a watcher's first build `saveMilliseconds` after it is made, or once `flush` is called,
 * unless it compiled nothing: it is then the saved build as it was. The builds after it are not
 * saved, since the next start compiles what they changed as edits.
 */
export function firstBuildSaver(): {
	took: (build: Build) => void;
	flush: () => Promise<void>;
} {
	let taken = false;
	let unsaved: Build | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> | undefined;
	const save = () => {
		clearTimeout(timer);
		// A build that cannot be saved, as when the outdir was removed, costs the next start its compile.
		if (unsaved !== undefined) saving = saveBuild(unsaved).catch(() => {});
		unsaved = undefined;
	};
	return {
		took: (build) => {
			if (taken) return;
			taken = true;
			if (build.compilation.changed.size === 0) return;
			unsaved = build;
			timer = setTimeout(save, saveMilliseconds);
			timer.unref();
		},
		flush: async () => {
			save();
			await saving;
		},
	};
}

/**
 * Saves a build for the next process's first compile, as V8 serializes it, in a file beside the
 * manifest. The file is written whole and then renamed into place, so a reader sees one build or
 * another, never part of one, whichever process saved it last.
 */
async function saveBuild(build: Build): Promise<void> {
	const catalogs = build.catalogs.map(
		({ locale, file, messages, paths }): SavedCatalog => ({
			locale,
			file,
			messages,
			paths,
		}),
	);
	const { keys, changed, formatted, errors } = build.compilation;
	const saved: Saved = {
		config: build.config,
		sources: build.sources,
		hashes: build.hashes,
		catalogs,
		compilation: { keys, changed, formatted, errors },
		positions: build.positions,
		rendered: build.rendered,
	};
	const state = join(build.config.outdir, stateDirectory);
	const temporary = join(state, `${savedFile}.${process.pid}.tmp`);
	await writeFile(
		temporary,
		Buffer.concat([Buffer.from(`${build.key}\n`), serialize(saved)]),
	);
	await rename(temporary, join(state, savedFile));
}

/**
 * The build the last process saved for this config and options, by this grai on this runtime, or
 * undefined if there is none: a compile that starts from it compiles only what changed since, as
 * after an edit. Its output is not taken to be on disk still, so that compile compares its files
 * with the outdir's.
 */
export async function savedBuild(
	configFile: string,
	pseudoLocale: boolean,
): Promise<Build | undefined> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		// A config that does not read is the compile's to report.
		if (error instanceof GraiError) return undefined;
		throw error;
	}
	const key = buildKey(config, pseudoLocale);
	const saved = await readSaved(
		join(config.outdir, stateDirectory, savedFile),
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
		written: undefined,
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
