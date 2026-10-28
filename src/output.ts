import { hash } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join, posix } from "node:path";
import { isMissing } from "./config.ts";
import {
	type Manifest,
	readManifest,
	removeManifest,
	writeManifest,
} from "./manifest.ts";
import {
	assertOutdirIsGrais,
	outdirContents,
	presentIn,
} from "./outdir-contents.ts";
import { lockOutput } from "./output-lock.ts";
import type { Output, OutputFile } from "./render.ts";
import { removeTemporary, writeTemporary } from "./replace-file.ts";
import { stateDirectory } from "./state-directory.ts";

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
	const present = await presentIn(outdir, files);
	return files.every((file) => present.has(file));
}

/**
 * Publishes an output, under the outdir's lock. It writes the immutable files that are not there
 * yet, and the others whose content the manifest does not record: the modules of keys with their
 * declarations, the declaration maps, and the entries, which name the rest. What is there is known
 * from a listing of the outdir and from the manifest, never from the memory of an earlier compile,
 * which another writer or a file deleted by hand makes wrong. Every text goes to a temporary file
 * first, all at once; then the immutable files are renamed into place, then the modules of keys,
 * then the mutable files, as no file names one of the first two until an entry does. The outdir is
 * grai's: a file the output no longer names that the manifest records is retired, and removed once
 * it has been for `retention`, and any other is removed at once, as is a temporary file a compile
 * that stopped halfway left. The manifest goes last. Returns the files written.
 */
export async function writeOutput(
	outdir: string,
	output: Output,
	inputs: string,
): Promise<string[]> {
	const state = join(outdir, stateDirectory);
	await assertOutdirIsGrais(outdir);
	const release = await lockOutput(state);
	try {
		const [manifest, contents] = await Promise.all([
			readManifest(state),
			outdirContents(outdir),
		]);
		const present = contents.files;
		const hashes = new Map(
			[...output.keyModules, ...output.mutable].map(([file, text, sha1]) => [
				file,
				sha1 ?? hash("sha1", text),
			]),
		);
		const recorded = new Map(Object.entries(manifest?.mutable ?? {}));
		const now = Date.now();
		const { retired, unknown } = unnamedFiles(manifest, output, present, now);
		const missing = output.immutable.filter(([file]) => !present.has(file));
		const changedOf = (files: readonly OutputFile[]) =>
			files.filter(
				([file]) =>
					!present.has(file) || recorded.get(file) !== hashes.get(file),
			);
		const changedModules = changedOf(output.keyModules);
		const changed = changedOf(output.mutable);
		const expired = [...retired]
			.filter(([, at]) => now - at >= retention)
			.map(([file]) => file);
		const removed = [...unknown, ...expired].map((file) => join(outdir, file));
		removed.push(...contents.temporaries);
		const replaced = [...changedModules, ...changed];
		if (
			missing.length + replaced.length + removed.length === 0 &&
			manifest?.inputs === inputs
		)
			return [];
		const written = [...missing, ...replaced];
		const [temporaries] = await Promise.all([
			writeTemporaries(written, state),
			replaced.length > 0 ? removeManifest(state) : undefined,
			makeDirectories(outdir, written, contents.directories),
		]);
		try {
			await renameInto(outdir, missing, temporaries);
			await renameInto(outdir, changedModules, temporaries);
			await renameInto(outdir, changed, temporaries);
		} catch (error) {
			await Promise.all([...temporaries.values()].map(removeTemporary));
			throw error;
		}
		await Promise.all(removed.map((path) => unlink(path).catch(ignoreMissing)));
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
 * The files in the outdir that this output does not name: those the manifest records, retired,
 * each with when it stopped being named, and the rest, which no compile's entry a reader holds can
 * name: an earlier layout's, or what a compile that stopped halfway wrote.
 */
function unnamedFiles(
	manifest: Manifest | undefined,
	output: Output,
	present: ReadonlySet<string>,
	now: number,
): { retired: Map<string, number>; unknown: string[] } {
	const named = new Set(namesOf(output));
	const recorded = new Set([
		...(manifest?.immutable ?? []),
		...Object.keys(manifest?.mutable ?? {}),
	]);
	const retiredAt = new Map(Object.entries(manifest?.retired ?? {}));
	const retired = new Map<string, number>();
	const unknown: string[] = [];
	for (const file of present) {
		if (named.has(file)) continue;
		const at = retiredAt.get(file);
		if (at !== undefined) retired.set(file, at);
		else if (recorded.has(file)) retired.set(file, now);
		else unknown.push(file);
	}
	return { retired, unknown };
}

function namesOf(output: Output): string[] {
	return [...output.immutable, ...output.keyModules, ...output.mutable].map(
		([file]) => file,
	);
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

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
