import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isMissing } from "./config.ts";

/** A file's new text, written to a temporary file of its own beside it. */
type Staged = { path: string; temporary: string };

/** What a file held, and its permissions. */
type Held = { content: Buffer; mode: number };

/** A file already replaced, and what it held before: nothing when it did not exist. */
type Replaced = { path: string; before: Held | undefined };

/**
 * Writes each file's new text, all of them or none. Each text first goes to a temporary file of
 * its own beside its file, created anew so that it overwrites nothing. Once every text is written,
 * each file's content and permissions are read, and the temporary file takes the permissions and
 * is renamed over it, so an executable script stays one. When one cannot be replaced, the files
 * already replaced get back what they held, the temporary files are removed, and the error is
 * thrown, so every file is as it was.
 */
export function writeAll(texts: ReadonlyMap<string, string>): void {
	const staged: Staged[] = [];
	try {
		for (const [path, text] of texts) {
			const temporary = temporaryBeside(path);
			writeNewFile(temporary, text);
			staged.push({ path, temporary });
		}
	} catch (error) {
		for (const { temporary } of staged) rmSync(temporary, { force: true });
		throw error;
	}
	const replaced: Replaced[] = [];
	try {
		for (const { path, temporary } of staged) {
			const before = heldIn(path);
			if (before !== undefined) chmodSync(temporary, before.mode);
			renameSync(temporary, path);
			replaced.push({ path, before });
		}
	} catch (error) {
		for (const { temporary } of staged.slice(replaced.length))
			rmSync(temporary, { force: true });
		putBack(replaced, error);
		throw error;
	}
}

/** A name for a temporary file of the writer's own, beside a file. */
function temporaryBeside(path: string): string {
	return `${path}.${randomUUID()}.tmp`;
}

/**
 * Writes a file that must not exist yet, so that it never overwrites another's. A file it fails
 * to write whole is removed.
 */
function writeNewFile(path: string, text: string | Buffer): void {
	const descriptor = openSync(path, "wx");
	let written = false;
	try {
		writeFileSync(descriptor, text);
		written = true;
	} finally {
		closeSync(descriptor);
		if (!written) rmSync(path, { force: true });
	}
}

/** What a file holds, and its permissions, or nothing when it does not exist. */
function heldIn(path: string): Held | undefined {
	try {
		return { content: readFileSync(path), mode: statSync(path).mode };
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

/**
 * Gives each replaced file back what it held, with its permissions, and removes the ones that did
 * not exist. Files that cannot be put back are named in the error thrown, with what stopped the
 * write and the put-back.
 */
function putBack(replaced: readonly Replaced[], cause: unknown): void {
	const failures: unknown[] = [];
	const kept: string[] = [];
	for (const { path, before } of replaced) {
		try {
			if (before === undefined) {
				rmSync(path, { force: true });
			} else {
				const temporary = temporaryBeside(path);
				writeNewFile(temporary, before.content);
				chmodSync(temporary, before.mode);
				renameSync(temporary, path);
			}
		} catch (error) {
			failures.push(error);
			kept.push(path);
		}
	}
	if (failures.length > 0) {
		throw new AggregateError(
			[cause, ...failures],
			`${kept.join(", ")} kept the new text: the write stopped (${String(cause)}), and putting back what they held failed.`,
		);
	}
}
