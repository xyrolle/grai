import { readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { isMissing } from "./config.ts";
import { GraiError } from "./error.ts";
import { stateDirectory } from "./state-directory.ts";

/**
 * What an outdir holds: its files, by their paths from it with `/`, the directories they are in,
 * and apart from them the temporary files in grai's state directory. Only a writer under the lock
 * makes a temporary file, one ending `.tmp`, so one that a writer under the lock finds was left by
 * a compile that stopped halfway. A watcher's save of its build is written outside the lock under
 * another name, `build.<pid>.<uuid>.saving` (`savingFile` in state-saves.ts), which is no temporary
 * here.
 */
export async function outdirContents(outdir: string): Promise<{
	files: Set<string>;
	directories: Set<string>;
	temporaries: string[];
}> {
	const entries = await readdir(outdir, {
		recursive: true,
		withFileTypes: true,
	}).catch((error: unknown) => {
		if (isMissing(error)) return [];
		throw error;
	});
	const files = new Set<string>();
	const directories = new Set<string>(["."]);
	const temporaries: string[] = [];
	const directoryOf = new Map<string, string>();
	for (const entry of entries) {
		let directory = directoryOf.get(entry.parentPath);
		if (directory === undefined) {
			directory = relative(outdir, entry.parentPath).split(sep).join(posix.sep);
			directoryOf.set(entry.parentPath, directory);
		}
		const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
		const inState = path.startsWith(`${stateDirectory}/`);
		if (entry.isDirectory()) {
			if (path !== stateDirectory && !inState) directories.add(path);
		} else if (!inState) {
			files.add(path);
		} else if (path.endsWith(".tmp")) {
			temporaries.push(join(outdir, path));
		}
	}
	return { files, directories, temporaries };
}

/**
 * Refuses an outdir that holds files but no state directory of grai's: as grai owns its outdir and
 * removes what no compile of its own names, it writes only into one that is empty, or that a compile
 * wrote.
 */
export async function assertOutdirIsGrais(outdir: string): Promise<void> {
	const names = await readdir(outdir).catch((error: unknown): string[] => {
		if (isMissing(error)) return [];
		throw error;
	});
	if (names.length === 0 || names.includes(stateDirectory)) return;
	throw new GraiError(
		"outdir-not-empty",
		{ file: outdir },
		`the outdir holds ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}, which no compile wrote: grai owns its outdir and removes what it does not name, so it writes only into a directory that is empty or of its own. Move those files out, or name another outdir.`,
	);
}

/** Which of these files are there, by listing each of their directories once. */
export async function presentIn(
	outdir: string,
	files: readonly string[],
): Promise<Set<string>> {
	const directories = new Set(files.map((file) => posix.dirname(file)));
	const listings = await Promise.all(
		[...directories].map(async (directory) => {
			const names = await readdir(join(outdir, directory)).catch(
				(error: unknown): string[] => {
					if (!isMissing(error)) throw error;
					return [];
				},
			);
			return names.map((name) => posix.join(directory, name));
		}),
	);
	return new Set(listings.flat());
}
