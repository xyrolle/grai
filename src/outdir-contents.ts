import { readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { isMissing } from "./config.ts";
import { GraiError } from "./error.ts";

/** grai's own directory in the outdir: the manifest, the writer's lock and files being written. */
export const stateDirectory = ".grai";

/**
 * What an outdir holds: its files, by their paths from it with `/`, the directories they are in,
 * and apart from them the temporary files in grai's state directory. Only a writer under the lock
 * makes a temporary file, so one that a writer under the lock finds was left by a compile that
 * stopped halfway.
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
	for (const entry of entries) {
		const path = relative(outdir, join(entry.parentPath, entry.name))
			.split(sep)
			.join(posix.sep);
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
