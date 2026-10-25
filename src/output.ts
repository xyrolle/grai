import { hash } from "node:crypto";
import { mkdir, readdir, rename, unlink } from "node:fs/promises";
import { join, posix } from "node:path";
import { isMissing } from "./config.ts";
import {
	type Manifest,
	readManifest,
	removeManifest,
	writeManifest,
} from "./manifest.ts";
import { lockOutput } from "./output-lock.ts";
import type { Output, OutputFile } from "./render.ts";
import { removeTemporary, writeTemporary } from "./replace-file.ts";

/** grai's own directory in the outdir: the manifest, the writer's lock and files being written. */
export const stateDirectory = ".grai";

/**
 * How long a file stays once the output stops naming it, in ms: far longer than a module loader
 * takes to load the rest of an output after reading one of its entries, which is milliseconds.
 */
const retention = 10_000;

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
	const files = [...manifest.immutable, ...Object.keys(manifest.mutable)];
	const { present } = await listed(outdir, files);
	return files.every((file) => present.has(file));
}

/**
 * Publishes an output, under the outdir's lock. It writes the immutable files that are not there
 * yet, and the mutable files whose content the manifest does not record: the declaration maps, and
 * the entries, which name the rest. What is there is known from a listing of the directories and
 * from the manifest, never from the memory of an earlier compile, which another writer or a file
 * deleted by hand makes wrong. Every text goes to a temporary file first, all at once; then the
 * immutable files are renamed into place, then the mutable ones, as no file names an immutable one
 * until an entry does. A file the output no longer names is retired, and removed once it has been
 * for `retention`. The manifest goes last. Returns the files written.
 */
export async function writeOutput(
	outdir: string,
	output: Output,
	inputs: string,
): Promise<string[]> {
	const state = join(outdir, stateDirectory);
	const release = await lockOutput(state);
	try {
		const [manifest, { present, directories }] = await Promise.all([
			readManifest(state),
			listed(outdir, namesOf(output)),
		]);
		const hashes = new Map(
			output.mutable.map(([file, text]) => [file, hash("sha1", text)]),
		);
		const recorded = new Map(Object.entries(manifest?.mutable ?? {}));
		const now = Date.now();
		const retired = retiredFiles(manifest, output, now);
		const missing = output.immutable.filter(([file]) => !present.has(file));
		const changed = output.mutable.filter(
			([file]) => !present.has(file) || recorded.get(file) !== hashes.get(file),
		);
		const expired = [...retired]
			.filter(([, at]) => now - at >= retention)
			.map(([file]) => file);
		if (
			missing.length + changed.length + expired.length === 0 &&
			manifest?.inputs === inputs
		)
			return [];
		const written = [...missing, ...changed];
		const [temporaries] = await Promise.all([
			writeTemporaries(written, state),
			changed.length > 0 ? removeManifest(state) : undefined,
			makeDirectories(outdir, written, directories),
		]);
		try {
			await renameInto(outdir, missing, temporaries);
			await renameInto(outdir, changed, temporaries);
		} catch (error) {
			await Promise.all([...temporaries.values()].map(removeTemporary));
			throw error;
		}
		await Promise.all(
			expired.map((file) => unlink(join(outdir, file)).catch(ignoreMissing)),
		);
		for (const file of expired) retired.delete(file);
		await writeManifest(state, {
			inputs,
			immutable: output.immutable.map(([file]) => file),
			mutable: Object.fromEntries(hashes),
			retired: Object.fromEntries(retired),
		});
		return written.map(([file]) => file);
	} finally {
		await release();
	}
}

/**
 * The files an earlier output named and this one does not, each with when it stopped being named:
 * the manifest's retired files, and the files of the output it records.
 */
function retiredFiles(
	manifest: Manifest | undefined,
	output: Output,
	now: number,
): Map<string, number> {
	const retired = new Map(Object.entries(manifest?.retired ?? {}));
	const recorded = [
		...(manifest?.immutable ?? []),
		...Object.keys(manifest?.mutable ?? {}),
	];
	for (const file of recorded) if (!retired.has(file)) retired.set(file, now);
	for (const file of namesOf(output)) retired.delete(file);
	return retired;
}

function namesOf(output: Output): string[] {
	return [...output.immutable, ...output.mutable].map(([file]) => file);
}

/**
 * Writes each file's text to a temporary file, all at once, and gives each file's temporary file.
 * When one fails, the others are removed and its error is thrown.
 */
async function writeTemporaries(
	files: readonly OutputFile[],
	state: string,
): Promise<Map<string, string>> {
	const results = await Promise.allSettled(
		files.map(
			async ([file, text]): Promise<[string, string]> => [
				file,
				await writeTemporary(text, state),
			],
		),
	);
	const temporaries = new Map(
		results.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		),
	);
	const failure = results.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (failure !== undefined) {
		await Promise.all([...temporaries.values()].map(removeTemporary));
		throw failure.reason;
	}
	return temporaries;
}

/** Renames each file's temporary file into place, all at once. */
async function renameInto(
	outdir: string,
	files: readonly OutputFile[],
	temporaries: ReadonlyMap<string, string>,
): Promise<void> {
	await Promise.all(
		files.map(async ([file]) => {
			const temporary = temporaries.get(file);
			if (temporary !== undefined) await rename(temporary, join(outdir, file));
		}),
	);
}

/** Makes the directories the files go to that are not there. */
async function makeDirectories(
	outdir: string,
	files: readonly OutputFile[],
	there: ReadonlySet<string>,
): Promise<void> {
	const directories = new Set(files.map(([file]) => posix.dirname(file)));
	await Promise.all(
		[...directories]
			.filter((directory) => !there.has(directory))
			.map((directory) => mkdir(join(outdir, directory), { recursive: true })),
	);
}

/**
 * Which of these files are there, by listing each of their directories once rather than looking
 * for each file, and which of those directories are there.
 */
async function listed(
	outdir: string,
	files: readonly string[],
): Promise<{ present: Set<string>; directories: Set<string> }> {
	const present = new Set<string>();
	const directories = new Set<string>();
	await Promise.all(
		[...new Set(files.map((file) => posix.dirname(file)))].map(
			async (directory) => {
				const names = await readdir(join(outdir, directory)).catch(
					(error: unknown) => {
						ignoreMissing(error);
						return undefined;
					},
				);
				if (names === undefined) return;
				directories.add(directory);
				for (const name of names) present.add(posix.join(directory, name));
			},
		),
	);
	return { present, directories };
}

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
