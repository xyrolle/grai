/**
 * Where a reading keeps the caches it takes up again (`facts-cache.ts`, `listing.ts`), each a text
 * by its name: files in the outdir's state directory, each written whole through a file of its own
 * and renamed into place; or memory, for a reading that must leave nothing on disk, as one that may
 * be stopped at any point (`next/group-worker.ts`), and that reads again in the same thread.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StateStore = {
	/** The text kept under a name, or none: nothing was kept, or it cannot be read. */
	read(name: string): string | undefined;
	write(name: string, text: string): void;
};

/** The caches kept as files in a state directory. */
export function stateFiles(directory: string): StateStore {
	return {
		read: (name) => {
			try {
				return readFileSync(join(directory, name), "utf8");
			} catch {
				return undefined;
			}
		},
		write: (name, text) => {
			mkdirSync(directory, { recursive: true });
			const file = join(directory, name);
			const temporary = `${file}.${process.pid}.${Date.now()}.saving`;
			writeFileSync(temporary, text);
			renameSync(temporary, file);
		},
	};
}

/** The caches kept in memory, for the readings that share this store alone. */
export function memoryStore(): StateStore {
	const texts = new Map<string, string>();
	return {
		read: (name) => texts.get(name),
		write: (name, text) => {
			texts.set(name, text);
		},
	};
}
