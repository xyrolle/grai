import { randomUUID } from "node:crypto";
import { readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "./config.ts";
import { isAlive } from "./output-lock.ts";

/**
 * The file one save of grai's state writes to before it renames it into place, created for that
 * save alone, named after the file it saves (`build`, `groups.json`). Not a `.tmp` file: a compile
 * under the output's lock removes those as left by a compile that stopped halfway, and a save does
 * not take the lock, which would hold up an edit's compile while 22 MB are written. Its own file
 * for each save, not for each process: two watchers of an outdir in one process saved through one
 * file at once, and the file renamed into place could be part of each, whole enough to read and to
 * render the old words. The pid in its name lets the next save remove one that a crash left, once
 * its process is gone (`removeStaleSaves`).
 */
export function savingFile(
	state: string,
	name: string,
	pid: number = process.pid,
): string {
	return join(state, `${name}.${pid}.${randomUUID()}.saving`);
}

/**
 * Saves a file of the outdir's state: written whole to a `savingFile` of this save's own, which it
 * creates and no other save opens, then renamed into place, so a reader sees one save or another,
 * never part of one, whichever save renamed last.
 */
export async function saveState(
	state: string,
	name: string,
	bytes: string | Uint8Array,
): Promise<void> {
	const temporary = savingFile(state, name);
	await removeStaleSaves(state, name);
	try {
		await writeFile(temporary, bytes, { flag: "wx" });
		await rename(temporary, join(state, name));
	} catch (error) {
		await unlink(temporary).catch(ignoreMissing);
		throw error;
	}
}

/** Removes the saves of a file that processes no longer running left halfway, as when one crashed. */
async function removeStaleSaves(state: string, name: string): Promise<void> {
	const saving = new RegExp(
		`^${name.replaceAll(".", "\\.")}\\.(\\d+)\\.[0-9a-f-]{36}\\.saving$`,
	);
	const names = await readdir(state).catch((error: unknown) => {
		if (isMissing(error)) return [];
		throw error;
	});
	await Promise.all(
		names.map(async (each) => {
			const pid = Number(saving.exec(each)?.[1]);
			if (!Number.isInteger(pid) || pid === process.pid || isAlive(pid)) return;
			await unlink(join(state, each)).catch(ignoreMissing);
		}),
	);
}

export function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
