import {
	link,
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isMissing } from "./config.ts";
import { GraiError } from "./error.ts";
import type { Output } from "./render.ts";

/** What the last compile wrote: a hash of what decided it, and its files. */
type Manifest = { inputs: string; files: string[] };

/** grai's own directory in the outdir: the manifest, the writer's lock and files being written. */
const stateDirectory = ".grai";
const lockRetry = 10;
const lockPatience = 30_000;

/** Whether the outdir holds the output of these inputs, every file of it in place. */
export async function isUpToDate(
	outdir: string,
	inputs: string,
): Promise<boolean> {
	const manifest = await readManifest(outdir);
	if (manifest?.inputs !== inputs) return false;
	const present = await Promise.all(
		manifest.files.map((file) =>
			stat(join(outdir, file)).then(
				() => true,
				() => false,
			),
		),
	);
	return present.every(Boolean);
}

/**
 * Writes the output level by level, the files of a level at once, each atomically: to a file
 * beside it, then renamed over it. A file whose content is already there is left untouched: as
 * the previous write left it, when that is known, else as it is on disk. Files of the last write
 * that are no longer output go next, then the manifest. Returns the files written.
 */
export async function writeOutput(
	outdir: string,
	output: Output,
	inputs: string,
	previous?: ReadonlyMap<string, string>,
): Promise<string[]> {
	const state = join(outdir, stateDirectory);
	await mkdir(state, { recursive: true });
	const release = await lock(state);
	try {
		const manifest = await readManifest(outdir);
		const written: string[] = [];
		const directories = new Set(
			output.flat().map(([file]) => dirname(join(outdir, file))),
		);
		for (const directory of directories)
			await mkdir(directory, { recursive: true });
		for (const level of output) {
			const changed = await Promise.all(
				level.map(async ([file, content]) => {
					const path = join(outdir, file);
					const same =
						previous === undefined
							? await holds(path, content)
							: previous.get(file) === content;
					if (same) return undefined;
					const temporary = join(state, `${file.replaceAll("/", "-")}.tmp`);
					await replace(path, temporary, content);
					return file;
				}),
			);
			for (const file of changed) if (file !== undefined) written.push(file);
		}
		const names = new Set(output.flat().map(([file]) => file));
		const before = new Set([
			...(manifest?.files ?? []),
			...(previous?.keys() ?? []),
		]);
		for (const file of before) {
			if (!names.has(file))
				await unlink(join(outdir, file)).catch(ignoreMissing);
		}
		const next: Manifest = { inputs, files: [...names] };
		await replace(
			join(state, "manifest.json"),
			join(state, "manifest.json.tmp"),
			`${JSON.stringify(next)}\n`,
		);
		return written;
	} finally {
		await release();
	}
}

async function replace(path: string, temporary: string, content: string) {
	await writeFile(temporary, content);
	await rename(temporary, path);
}

async function holds(path: string, content: string): Promise<boolean> {
	try {
		return (await readFile(path, "utf8")) === content;
	} catch (error) {
		ignoreMissing(error);
		return false;
	}
}

async function readManifest(outdir: string): Promise<Manifest | undefined> {
	try {
		const manifest: unknown = JSON.parse(
			await readFile(join(outdir, stateDirectory, "manifest.json"), "utf8"),
		);
		return isManifest(manifest) ? manifest : undefined;
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		ignoreMissing(error);
		return undefined;
	}
}

function isManifest(value: unknown): value is Manifest {
	return (
		typeof value === "object" &&
		value !== null &&
		"inputs" in value &&
		typeof value.inputs === "string" &&
		"files" in value &&
		Array.isArray(value.files) &&
		value.files.every((file) => typeof file === "string")
	);
}

/**
 * Takes the outdir's lock: a file holding this process's pid, linked into place so it exists only
 * with its pid in it. A lock whose process is gone is stale and taken over; a live one is waited for.
 */
async function lock(state: string): Promise<() => Promise<void>> {
	const path = join(state, "lock");
	const claim = join(state, `lock.${process.pid}`);
	await writeFile(claim, String(process.pid));
	const started = Date.now();
	try {
		for (;;) {
			if (await linked(claim, path)) return () => unlink(path);
			const holder = Number(
				await readFile(path, "utf8").catch((error: unknown) => {
					ignoreMissing(error);
					return "";
				}),
			);
			if (!isAlive(holder)) {
				await unlink(path).catch(ignoreMissing);
				continue;
			}
			if (Date.now() - started > lockPatience) {
				throw new GraiError(
					"output-locked",
					{ file: join(stateDirectory, "lock") },
					`process ${holder} has held the output's lock for ${lockPatience / 1000} s. If no grai is running, delete ${path}.`,
				);
			}
			await delay(lockRetry);
		}
	} finally {
		await unlink(claim);
	}
}

/** Links the claim to the lock's path, or false if a lock is already there. */
async function linked(claim: string, path: string): Promise<boolean> {
	try {
		await link(claim, path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			return false;
		throw error;
	}
}

function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
