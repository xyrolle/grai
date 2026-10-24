import { renameSync, rmSync, writeFileSync } from "node:fs";

/**
 * Writes each file's new text, all of them or none: every text goes to a temporary file beside
 * its file first, and only when all are written is each renamed over its file. A write that fails
 * removes the temporary files and leaves every file as it was.
 */
export function writeAll(texts: ReadonlyMap<string, string>): void {
	const staged: string[] = [];
	try {
		for (const [path, text] of texts) {
			writeFileSync(`${path}.tmp`, text);
			staged.push(path);
		}
	} catch (error) {
		for (const path of staged) rmSync(`${path}.tmp`, { force: true });
		throw error;
	}
	for (const path of staged) renameSync(`${path}.tmp`, path);
}
