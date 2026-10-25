import {
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { isMissing } from "./config.ts";
import { lockOutput } from "./output-lock.ts";
import type { Output } from "./render.ts";

/** What the last compile wrote: a hash of what decided it, and its files. */
type Manifest = { inputs: string; files: string[] };

/** grai's own directory in the outdir: the manifest, the writer's lock and files being written. */
const stateDirectory = ".grai";

/**
 * Whether the outdir holds the output of these inputs, every file of it in place. The files are
 * looked for by listing their few directories, not one by one, so the check costs the same however
 * many files there are.
 */
export async function isUpToDate(
	outdir: string,
	inputs: string,
): Promise<boolean> {
	const manifest = await readManifest(outdir);
	if (manifest?.inputs !== inputs) return false;
	const directories = new Set(
		manifest.files.map((file) => posix.dirname(file)),
	);
	const listed = await Promise.all(
		[...directories].map(async (directory) => {
			const names = await readdir(join(outdir, directory)).catch(
				(error: unknown) => {
					ignoreMissing(error);
					return [];
				},
			);
			return names.map((name) => posix.join(directory, name));
		}),
	);
	const present = new Set(listed.flat());
	return manifest.files.every((file) => present.has(file));
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
	const release = await lockOutput(state);
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

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
