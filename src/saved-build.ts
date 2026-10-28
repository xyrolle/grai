import { hash } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { buildKey, type CompileOptions } from "./build-key.ts";
import { type Catalog, readCatalogSources } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import type { Build } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import type { DeclaredKey } from "./key-declarations.ts";
import { type ServedIndex, servedIndex } from "./served.ts";
import { stateDirectory } from "./state-directory.ts";
import { ignoreMissing, saveState, savingFile } from "./state-saves.ts";

/**
 * A build as saved: every field of it but its key, which heads the file, and of each catalog every
 * field but its revision and edit. A revision is a symbol of the process that parsed the catalog,
 * so the build taken up gives each catalog a new one, and the edit it came from is the past's. No
 * field is listed, so one a build gains is saved with the rest. A catalog is saved once however
 * many lists hold it, a file's that is its locale's too, so it is one catalog again when taken up.
 */
type Saved = Omit<Build, "key" | "parts" | "catalogs" | "compilation"> & {
	parts: readonly SavedCatalog[];
	catalogs: readonly SavedCatalog[];
	compilation: Omit<Compilation<DeclaredKey>, "catalogs"> & {
		catalogs: readonly SavedCatalog[];
	};
};
type SavedCatalog = Omit<Catalog, "revision" | "edit">;

/**
 * The file of the saved build in the outdir's state: its key on the first line; on the second, the
 * lengths of the build's index (`servedIndex`) and of the build; then each as V8 serializes it. A
 * file cut short is never taken for one, and a restart reads the index alone.
 */
const savedName = "build";

/** How many bytes the key and the lengths take at most, which a read of the file starts with. */
const headerBytes = 4096;

/**
 * Saves a build for the next process's first compile, as V8 serializes it, in a file beside the
 * manifest, through a file of this save's own (`saveState`).
 */
export async function saveBuild(build: Build): Promise<void> {
	await saveState(
		join(build.config.outdir, stateDirectory),
		savedName,
		savedBytes(build),
	);
}

/**
 * Saves a build as `saveBuild` does, synchronously, as the process exits and nothing waits for a
 * promise. It leaves any stale save to the next `saveBuild`.
 */
export function saveBuildNow(build: Build): void {
	const state = join(build.config.outdir, stateDirectory);
	const temporary = savingFile(state, savedName);
	try {
		writeFileSync(temporary, savedBytes(build), { flag: "wx" });
		renameSync(temporary, join(state, savedName));
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch (removing) {
			ignoreMissing(removing);
		}
		throw error;
	}
}

/** A build's bytes as saved: its key, the lengths of its index and of the build, and the two. */
function savedBytes(build: Build): Buffer {
	const { key, parts, catalogs, compilation, ...rest } = build;
	const savedOf = new Map<Catalog, SavedCatalog>();
	const save = (catalog: Catalog) => {
		const saved = savedOf.get(catalog) ?? withoutRevision(catalog);
		savedOf.set(catalog, saved);
		return saved;
	};
	const saved: Saved = {
		...rest,
		parts: parts.map(save),
		catalogs: catalogs.map(save),
		compilation: { ...compilation, catalogs: compilation.catalogs.map(save) },
	};
	const index = serialize(servedIndex(build));
	const payload = serialize(saved);
	return Buffer.concat([
		Buffer.from(`${key}\n${index.length} ${payload.length}\n`),
		index,
		payload,
	]);
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
	const saved = await savedSection<Saved>(
		join(config.outdir, stateDirectory, savedName),
		key,
		"build",
	);
	if (saved === undefined) return undefined;
	const takenUp = new Map<SavedCatalog, Catalog>();
	const takeUp = (catalog: SavedCatalog) => {
		const parsed = takenUp.get(catalog) ?? {
			...catalog,
			revision: Symbol(catalog.locale),
		};
		takenUp.set(catalog, parsed);
		return parsed;
	};
	return {
		...saved,
		parts: saved.parts.map(takeUp),
		catalogs: saved.catalogs.map(takeUp),
		compilation: {
			...saved.compilation,
			catalogs: saved.compilation.catalogs.map(takeUp),
		},
		key,
	};
}

/**
 * The index of the build the last process saved for this config and options (`servedIndex`), if
 * the catalogs are as they were when it was compiled: what a dev server serves before the build is
 * taken up. Undefined if there is none, or a catalog changed or cannot be read since.
 */
export async function savedIndex(
	configFile: string,
	options: CompileOptions,
): Promise<ServedIndex | undefined> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return undefined;
		throw error;
	}
	const index = await savedSection<ServedIndex>(
		join(config.outdir, stateDirectory, savedName),
		buildKey(config, options),
		"index",
	);
	if (index === undefined) return undefined;
	const { sources, errors } = await readCatalogSources(config);
	const same =
		errors.length === 0 &&
		sources.length === index.hashes.length &&
		sources.every(
			(source, at) => hash("sha1", source.bytes) === index.hashes[at],
		);
	return same ? index : undefined;
}

/**
 * A section of the build a file saved under this key, its index or the build, as V8 serialized it,
 * or undefined if the file holds another key's or none. A saved build only spares a compile, so a
 * file that cannot be read, or that a crash cut short, which the lengths on its second line tell,
 * is none. The key names the grai that saved the file, so a section is this module's to type.
 */
async function savedSection<Section>(
	file: string,
	key: string,
	section: "index" | "build",
): Promise<Section | undefined> {
	const header = Buffer.from(`${key}\n`);
	try {
		const handle = await open(file);
		try {
			const head = Buffer.alloc(headerBytes);
			const { bytesRead } = await handle.read(head, 0, headerBytes, 0);
			const lengthsEnd = head.indexOf("\n", header.length);
			if (
				!head.subarray(0, header.length).equals(header) ||
				lengthsEnd === -1 ||
				lengthsEnd >= bytesRead
			)
				return undefined;
			const lengths = /^(\d+) (\d+)$/.exec(
				head.subarray(header.length, lengthsEnd).toString(),
			);
			if (lengths === null) return undefined;
			const index = Number(lengths[1]);
			const build = Number(lengths[2]);
			const start = lengthsEnd + 1;
			const { size } = await handle.stat();
			if (size !== start + index + build) return undefined;
			const [offset, length] =
				section === "index" ? [start, index] : [start + index, build];
			const bytes = Buffer.alloc(length);
			await handle.read(bytes, 0, length, offset);
			return deserialize(bytes);
		} finally {
			await handle.close();
		}
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
