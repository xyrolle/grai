import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissing } from "./config.ts";

/**
 * Writes a file atomically: to a temporary file of the writer's own in `directory`, created anew
 * so that it overwrites nothing, then renamed over the file. A reader sees the old file or the
 * new one, never part of one. A temporary file that cannot be renamed is removed.
 */
export async function replaceFile(
	path: string,
	text: string,
	directory: string,
): Promise<void> {
	const temporary = join(directory, `${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, text, { flag: "wx" });
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary).catch((unlinked: unknown) => {
			if (!isMissing(unlinked)) throw unlinked;
		});
		throw error;
	}
}
