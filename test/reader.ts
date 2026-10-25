import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { onTestFinished } from "vitest";
import type { Messages } from "./project.ts";

/**
 * Reads an output as a module loader does, from messages.js, each module before the modules it
 * imports, and copies what it read to a directory of its own, removed after the test. Gives the
 * copy's messages.js, or the error a read met, as a missing file.
 */
export async function loadedCopy(out: string): Promise<string | Error> {
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
	try {
		await visit("messages.js");
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
	return join(copy, "messages.js");
}

/** A project's messages, imported afresh from a copy of its output as a module loader reads it. */
export async function messagesOf(dir: string): Promise<Messages> {
	const copy = await loadedCopy(join(dir, "out"));
	if (typeof copy !== "string") throw copy;
	return (await import(pathToFileURL(copy).href)).m;
}
