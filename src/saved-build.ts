import { hash } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { type Catalog, readCatalogSources } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import { type Build, buildKey, type CompileOptions } from "./compile.ts";
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
 * lengths of the build's index (`servedIndex`) and of the build, and the SHA-256 digest of each;
 * then each as V8 serializes it. A file cut short, or a section whose bytes are not those saved, is
 * never taken for one, and a restart reads the index alone.
 */
const savedName = "build";

/** How many bytes the key and the second line take at most, which a read of the file starts with. */
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

/** A build's bytes as saved: its key, the length and digest of its index and of the build, and the two. */
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
		Buffer.from(
			`${key()}\n${index.length} ${payload.length} ${digestOf(index)} ${digestOf(payload)}\n`,
		),
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
	const keyOf = keyFor(config, options);
	const file = await openSaved(config, keyOf);
	if (file === undefined) return undefined;
	try {
		return await buildOf(file, keyOf);
	} finally {
		await file.handle.close();
	}
}

/**
 * The build key of a config and options (`buildKey`), made when first asked for: only once there is
 * a saved build, as its compiler's identity reads the compiler.
 */
function keyFor(config: Config, options: CompileOptions): () => string {
	let key: string | undefined;
	return () => {
		key ??= buildKey(config, options);
		return key;
	};
}

/** The build a saved file holds, taken up: undefined if its bytes are not those saved. */
async function buildOf(
	file: SavedFile,
	key: () => string,
): Promise<Build | undefined> {
	const saved = await section<Saved>(file, "build");
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
 * A saved build's index, what a dev server serves before the build is taken up, and that build: of
 * the same save, as the file read stays open until the build is read or `close` is called, whatever
 * another process saves meanwhile.
 */
export type SavedIndex = {
	index: ServedIndex;
	/** The build of the same save, taken up, which closes the file; undefined if its bytes are not those saved. */
	build: () => Promise<Build | undefined>;
	/** Closes the file, where the build is not to be read. */
	close: () => Promise<void>;
};

/**
 * The index of the build the last process saved for this config and options (`servedIndex`), if
 * the catalogs are as they were when it was compiled, with the build of that save. Undefined if
 * there is none, or a catalog changed or cannot be read since.
 */
export async function savedIndex(
	configFile: string,
	options: CompileOptions,
): Promise<SavedIndex | undefined> {
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (error instanceof GraiError) return undefined;
		throw error;
	}
	const keyOf = keyFor(config, options);
	const file = await openSaved(config, keyOf);
	if (file === undefined) return undefined;
	let closing: Promise<void> | undefined;
	const close = () => {
		closing ??= file.handle.close();
		return closing;
	};
	const index = await section<ServedIndex>(file, "index");
	const { sources, errors } = await readCatalogSources(config);
	const same =
		index !== undefined &&
		errors.length === 0 &&
		sources.length === index.hashes.length &&
		sources.every(
			(source, at) => hash("sha1", source.bytes) === index.hashes[at],
		);
	if (!same) {
		await close();
		return undefined;
	}
	let build: Promise<Build | undefined> | undefined;
	return {
		index,
		build: () => {
			build ??= buildOf(file, keyOf).finally(close);
			return build;
		},
		close,
	};
}

/** A saved file, open, and where each of its sections is, with the digest its bytes must have. */
type SavedFile = {
	handle: FileHandle;
	index: SectionPlace;
	build: SectionPlace;
};
type SectionPlace = { offset: number; length: number; digest: string };

/** The second line of a saved file: the length and digest of its index and of its build. */
const savedPlaces = /^(\d+) (\d+) ([0-9a-f]{64}) ([0-9a-f]{64})$/;

/**
 * The file of the build the last process saved under this key, open, or undefined if it holds
 * another key's or none. A saved build only spares a compile, so a file that cannot be read, or
 * that a crash cut short, which the lengths on its second line tell, is none. The key is made only
 * once the file is open.
 */
async function openSaved(
	config: Config,
	key: () => string,
): Promise<SavedFile | undefined> {
	let handle: FileHandle;
	try {
		handle = await open(join(config.outdir, stateDirectory, savedName));
	} catch {
		return undefined;
	}
	try {
		const header = Buffer.from(`${key()}\n`);
		const head = Buffer.alloc(headerBytes);
		const { bytesRead } = await handle.read(head, 0, headerBytes, 0);
		const placesEnd = head.indexOf("\n", header.length);
		const places =
			head.subarray(0, header.length).equals(header) &&
			placesEnd !== -1 &&
			placesEnd < bytesRead
				? savedPlaces.exec(head.subarray(header.length, placesEnd).toString())
				: null;
		const start = placesEnd + 1;
		const indexLength = Number(places?.[1]);
		const buildLength = Number(places?.[2]);
		const { size } = await handle.stat();
		if (places === null || size !== start + indexLength + buildLength) {
			await handle.close();
			return undefined;
		}
		return {
			handle,
			index: { offset: start, length: indexLength, digest: places[3] ?? "" },
			build: {
				offset: start + indexLength,
				length: buildLength,
				digest: places[4] ?? "",
			},
		};
	} catch {
		await handle.close();
		return undefined;
	}
}

/**
 * A section of a saved file, its index or the build, as V8 serialized it: undefined if it cannot be
 * read or its bytes are not those saved, which their digest tells. The key names the grai that
 * saved the file, so a section is this module's to type.
 */
async function section<Section>(
	file: SavedFile,
	name: "index" | "build",
): Promise<Section | undefined> {
	const { offset, length, digest } = file[name];
	try {
		const bytes = Buffer.alloc(length);
		const { bytesRead } = await file.handle.read(bytes, 0, length, offset);
		if (bytesRead !== length || digestOf(bytes) !== digest) return undefined;
		return deserialize(bytes);
	} catch {
		return undefined;
	}
}

/** The digest of a section's bytes, as the saved file's second line has it. */
function digestOf(bytes: Buffer): string {
	return hash("sha256", bytes);
}

/** A catalog as saved: all of it but its revision and its edit, which are this process's. */
function withoutRevision({
	revision: _revision,
	edit: _edit,
	...catalog
}: Catalog): SavedCatalog {
	return catalog;
}
