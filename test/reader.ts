import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { onTestFinished } from "vitest";
import type { Messages } from "./project.ts";

/**
 * A reader of an output, as a module loader is: it reads an entry, then each module before the
 * modules it imports, every module once however many import it, and copies what it read to a
 * directory of its own, removed after the test. Entries read one after the other land in the one
 * copy, as one application's imports do.
 */
export function outputReader(out: string): {
	copy: string;
	read(entry: string): Promise<void>;
} {
	const copy = mkdtempSync(join(tmpdir(), "grai-read-"));
	onTestFinished(() => rmSync(copy, { recursive: true, force: true }));
	const read = new Set<string>();
	const visit = async (file: string): Promise<void> => {
		if (read.has(file)) return;
		read.add(file);
		const text = await readFile(join(out, file), "utf8");
		mkdirSync(dirname(join(copy, file)), { recursive: true });
		writeFileSync(join(copy, file), text);
		const imports = [...text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)].map(
			([, specifier = ""]) =>
				posix.normalize(posix.join(posix.dirname(file), specifier)),
		);
		await Promise.all(imports.map(visit));
	};
	return { copy, read: visit };
}

/**
 * Reads an output from messages.js, as `outputReader` does, and gives the copy's messages.js, or
 * the error a read met, as a missing file.
 */
export async function loadedCopy(out: string): Promise<string | Error> {
	const reader = outputReader(out);
	try {
		await reader.read("messages.js");
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
	return join(reader.copy, "messages.js");
}

/** A project's messages, imported afresh from a copy of its output as a module loader reads it. */
export async function messagesOf(dir: string): Promise<Messages> {
	const copy = await loadedCopy(join(dir, "out"));
	if (typeof copy !== "string") throw copy;
	return (await import(pathToFileURL(copy).href)).m;
}
