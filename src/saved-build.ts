import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { Catalog } from "./catalog.ts";
import type { Compilation } from "./compilation.ts";
import { type Build, buildKey, type CompileOptions } from "./compile.ts";
import { type Config, isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { isAlive } from "./output-lock.ts";
import { stateDirectory } from "./state-directory.ts";

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
	compilation: Omit<Compilation, "catalogs"> & {
		catalogs: readonly SavedCatalog[];
	};
};
type SavedCatalog = Omit<Catalog, "revision" | "edit">;

/**
 * The file of the saved build in the outdir's state: its key on the first line, the length of the
 * build on the second, then the build, so a file cut short is never taken for one.
 */
const savedName = "build";

/**
 * The file one save writes to before it renames it into place, created for that save alone. Not a
 * `.tmp` file: a compile under the output's lock removes those as left by a compile that stopped
 * halfway, and a save does not take the lock, which would hold up an edit's compile while 22 MB are
 * written. Its own file for each save, not for each process: two watchers of an outdir in one
 * process saved through one file at once, and the build renamed into place could be part of each,
 * whole enough to read and to render the old words. The pid in its name lets the next save remove
 * one that a crash left, once its process is gone (`removeStaleSaves`).
 */
export function savingFile(state: string, pid: number = process.pid): string {
	return join(state, `${savedName}.${pid}.${randomUUID()}.saving`);
}
const savingName = new RegExp(
	`^${savedName}\\.(\\d+)\\.[0-9a-f-]{36}\\.saving$`,
);

/**
 * Saves a build for the next process's first compile, as V8 serializes it, in a file beside the
 * manifest. The file is written whole to a `savingFile` of this save's own, which it creates and
 * no other save opens, and then renamed into place, so a reader sees one build or another, never
 * part of one, whichever save renamed last.
 */
export async function saveBuild(build: Build): Promise<void> {
	const { temporary, file, bytes } = savedFile(build);
	await removeStaleSaves(dirname(file));
	try {
		await writeFile(temporary, bytes, { flag: "wx" });
		await rename(temporary, file);
	} catch (error) {
		await unlink(temporary).catch(ignoreMissing);
		throw error;
	}
}

/**
 * Saves a build as `saveBuild` does, synchronously, as the process exits and nothing waits for a
 * promise. It leaves any stale save to the next `saveBuild`.
 */
export function saveBuildNow(build: Build): void {
	const { temporary, file, bytes } = savedFile(build);
	try {
		writeFileSync(temporary, bytes, { flag: "wx" });
		renameSync(temporary, file);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch (removing) {
			ignoreMissing(removing);
		}
		throw error;
	}
}

/** Removes the saves that processes no longer running left halfway, as when one crashed. */
async function removeStaleSaves(state: string): Promise<void> {
	const names = await readdir(state).catch((error: unknown) => {
		if (isMissing(error)) return [];
		throw error;
	});
	await Promise.all(
		names.map(async (name) => {
			const pid = Number(savingName.exec(name)?.[1]);
			if (!Number.isInteger(pid) || pid === process.pid || isAlive(pid)) return;
			await unlink(join(state, name)).catch(ignoreMissing);
		}),
	);
}

/** A build's saved file: its bytes, its path, and the path it is written to first. */
function savedFile(build: Build): {
	temporary: string;
	file: string;
	bytes: Buffer;
} {
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
	const state = join(build.config.outdir, stateDirectory);
	const payload = serialize(saved);
	return {
		temporary: savingFile(state),
		file: join(state, savedName),
		bytes: Buffer.concat([Buffer.from(`${key}\n${payload.length}\n`), payload]),
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
	const key = await buildKey(config, options);
	const saved = await readSaved(
		join(config.outdir, stateDirectory, savedName),
		key,
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
 * The build a file saved under this key, or undefined if it holds another key's or none. A saved
 * build only spares a compile, so a file that cannot be read, or that a crash cut short, which its
 * length on the second line tells, is none.
 */
async function readSaved(
	file: string,
	key: string,
): Promise<Saved | undefined> {
	const header = Buffer.from(`${key}\n`);
	try {
		const bytes = await readFile(file);
		if (!bytes.subarray(0, header.length).equals(header)) return undefined;
		const lengthEnd = bytes.indexOf("\n", header.length);
		const payload = bytes.subarray(lengthEnd + 1);
		const length = Number(bytes.subarray(header.length, lengthEnd).toString());
		if (lengthEnd === -1 || payload.length !== length) return undefined;
		// The key names the grai that saved the build, so it is this module's `Saved`.
		return deserialize(payload);
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

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
