import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "./config.ts";

/**
 * Writes a text to a temporary file of the writer's own in `directory`, created anew so that it
 * overwrites nothing, for it to be renamed over the file it is the new text of. One written in
 * part is removed. Returns its path.
 */
export async function writeTemporary(
	text: string,
	directory: string,
): Promise<string> {
	const temporary = join(directory, `${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, text, { flag: "wx" });
	} catch (error) {
		await removeTemporary(temporary);
		throw error;
	}
	return temporary;
}

/** Removes a temporary file, if it is still there. */
export async function removeTemporary(temporary: string): Promise<void> {
	await unlink(temporary).catch((error: unknown) => {
		if (!isMissing(error)) throw error;
	});
}

/**
 * Writes a file atomically: to a temporary file, then renamed over the file. A reader sees the old
 * file or the new one, never part of one.
 */
export async function replaceFile(
	path: string,
	text: string,
	directory: string,
): Promise<void> {
	const temporary = await writeTemporary(text, directory);
	try {
		await rename(temporary, path);
	} catch (error) {
		await removeTemporary(temporary);
		throw error;
	}
}
