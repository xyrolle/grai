import { hash } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { isMissing } from "./config.ts";
import { readManifest, removeManifest, writeManifest } from "./manifest.ts";
import { lockOutput } from "./output-lock.ts";
import type { Output } from "./render.ts";
import { replaceFile } from "./replace-file.ts";

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
	const manifest = await readManifest(join(outdir, stateDirectory));
	if (manifest?.inputs !== inputs) return false;
	const files = Object.keys(manifest.files);
	const present = await listed(outdir, files);
	return files.every((file) => present.has(file));
}

/**
 * Writes the output level by level, the files of a level at once, each atomically, under the
 * outdir's lock. A file is written when a listing of its directory lacks it, or when the manifest
 * does not record what it holds: what is there is learned from the outdir, never from an earlier
 * compile's memory of what it wrote, which another writer or a file deleted by hand makes wrong.
 * Files the manifest records and the output no longer has go next, then the manifest. Returns the
 * files written.
 */
export async function writeOutput(
	outdir: string,
	output: Output,
	inputs: string,
): Promise<string[]> {
	const state = join(outdir, stateDirectory);
	const release = await lockOutput(state);
	try {
		const manifest = await readManifest(state);
		const files = output.flat();
		const hashes = new Map(
			files.map(([file, text]) => [file, hash("sha1", text)]),
		);
		const recorded = new Map(Object.entries(manifest?.files ?? {}));
		const present = await listed(
			outdir,
			files.map(([file]) => file),
		);
		const isThere = (file: string) =>
			present.has(file) && recorded.get(file) === hashes.get(file);
		const gone = [...recorded.keys()].filter((file) => !hashes.has(file));
		const written: string[] = [];
		for (const level of output) {
			for (const [file] of level) if (!isThere(file)) written.push(file);
		}
		if (written.length + gone.length === 0 && manifest?.inputs === inputs)
			return [];
		if (written.length > 0) await removeManifest(state);
		for (const directory of new Set(files.map(([file]) => dirname(file))))
			await mkdir(join(outdir, directory), { recursive: true });
		for (const level of output) {
			await Promise.all(
				level
					.filter(([file]) => !isThere(file))
					.map(([file, text]) => replaceFile(join(outdir, file), text, state)),
			);
		}
		await Promise.all(
			gone.map((file) => unlink(join(outdir, file)).catch(ignoreMissing)),
		);
		await writeManifest(state, { inputs, files: Object.fromEntries(hashes) });
		return written;
	} finally {
		await release();
	}
}

/**
 * Which of these files are there, by listing each of their directories once rather than looking
 * for each file.
 */
async function listed(
	outdir: string,
	files: readonly string[],
): Promise<Set<string>> {
	const directories = new Set(files.map((file) => posix.dirname(file)));
	const listings = await Promise.all(
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
	return new Set(listings.flat());
}

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
