import { renameSync, writeFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { deserialize, serialize } from "node:v8";
import type { Catalog } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import { type Build, buildKey, type CompileOptions } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { stateDirectory } from "./output.ts";

/**
 * A build as saved. A catalog's revision is a symbol of the process that parsed it, so the build
 * taken up gives each catalog a new one, and the edit it came from is the past's.
 */
type Saved = Omit<Build, "key" | "catalogs" | "compilation"> & {
	catalogs: readonly SavedCatalog[];
	compilation: Omit<Compilation, "catalogs">;
};
type SavedCatalog = Omit<Catalog, "revision" | "edit">;

/** The file of the saved build in the outdir's state: its key on the first line, then the build. */
const savedName = "build";

/**
 * When the process is quiet: a window of `quietMilliseconds` in which its event loop worked less
 * than `quietShare` of the time. A dev server keeps its loop busy while it starts and while it
 * answers a page's requests, and hardly at all while it waits for an edit. Saving app A's build
 * (6,379 keys × 3) takes about 20 ms to serialize 22 MB, which a start, about 5 s of work for app
 * A, should not take on.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/**
 * Saves a watcher's first build once the process is quiet, once `flush` is called, or as the
 * process exits, unless it compiled nothing: it is then the saved build as it was. The builds after
 * it are not saved, since the next start compiles what they changed as edits. The save at exit is
 * for a process that ends before it is quiet: a dev server stopped by SIGTERM, which Vite closes,
 * though in an app whose other SIGTERM handler exits at once (app A's), it never closes.
 */
export function firstBuildSaver(): {
	took: (build: Build) => void;
	flush: () => Promise<void>;
} {
	let taken = false;
	let unsaved: Build | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let saving: Promise<void> | undefined;
	// A build that cannot be saved, as when the outdir was removed, costs only the next start its compile.
	const save = () => {
		clearInterval(timer);
		process.off("exit", saveNow);
		if (unsaved !== undefined) saving = saveBuild(unsaved).catch(() => {});
		unsaved = undefined;
	};
	/** At exit, where nothing waits for a promise. */
	const saveNow = () => {
		if (unsaved === undefined) return;
		try {
			const { temporary, file, bytes } = savedFile(unsaved);
			writeFileSync(temporary, bytes);
			renameSync(temporary, file);
		} catch {}
	};
	return {
		took: (build) => {
			if (taken) return;
			taken = true;
			if (build.compilation.changed.size === 0) return;
			unsaved = build;
			let since = performance.eventLoopUtilization();
			timer = setInterval(() => {
				const window = performance.eventLoopUtilization(since);
				since = performance.eventLoopUtilization();
				if (window.utilization < quietShare) save();
			}, quietMilliseconds);
			timer.unref();
			process.once("exit", saveNow);
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
	const { temporary, file, bytes } = savedFile(build);
	await writeFile(temporary, bytes);
	await rename(temporary, file);
}

/** A build's saved file: its bytes, its path, and the path it is written to first. */
function savedFile(build: Build): {
	temporary: string;
	file: string;
	bytes: Buffer;
} {
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
	return {
		temporary: join(state, `${savedName}.${process.pid}.tmp`),
		file: join(state, savedName),
		bytes: Buffer.concat([Buffer.from(`${build.key}\n`), serialize(saved)]),
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
