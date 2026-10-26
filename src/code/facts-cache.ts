/**
 * Each file's facts kept on disk, in the outdir's `.grai/` state, which Git ignores already, so a
 * command reads again only the files that changed since the last. An entry is a file's facts, never
 * its tree, by the hash of its text, under the code that read it: grai's reader, by its contents,
 * and the versions of the parsers it loads, so any change to them reads every file again. The cache
 * is written whole and atomically after a command that read a file again or found one gone, with the
 * files that command read, so an entry for a file gone or changed is dropped. Each file's facts are
 * kept as JSON, which V8 reads back in about half the time its own serializer takes for the same
 * facts (75 MB of them, for 9,000 files). A file's JSON is parsed only when a command takes its
 * facts, and a save writes each entry it kept as it was read, so it makes no file's JSON again.
 */

import { createHash, hash } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileFacts } from "./facts.ts";

/** What the cache holds for a file: its text's hash, and its facts as JSON. */
type Entry = { hash: string; json: string };

/** A file's facts, read, and their JSON, which the cache keeps as it is. */
export type FactsRead = { facts: FileFacts; json: string };

/** The packages whose versions decide what a file's facts are: grai's parser and the frameworks'. */
const readers = ["oxc-parser", "svelte", "vue", "astro", "@mdx-js/mdx"];

const require = createRequire(import.meta.url);

export class FactsCache {
	private readonly file: string;
	private readonly version = readerVersion(
		dirname(fileURLToPath(import.meta.url)),
	);
	private readonly read: ReadonlyMap<string, Entry>;
	private readonly kept = new Map<string, Entry>();
	private added = false;

	/** The cache of a project's facts, in its outdir's state, or an empty one. */
	constructor(stateDirectory: string) {
		this.file = join(stateDirectory, "facts");
		this.read = load(this.file, this.version);
	}

	/** A file's facts, if the cache has them for the text of this hash (`textHash`). */
	get(path: string, hash: string): FileFacts | undefined {
		const entry = this.read.get(path);
		if (entry === undefined || entry.hash !== hash) return undefined;
		this.kept.set(path, entry);
		return JSON.parse(entry.json);
	}

	set(path: string, hash: string, { json }: FactsRead): void {
		this.kept.set(path, { hash, json });
		this.added = true;
	}

	/**
	 * Writes the facts of the files read this time, and only those, unless they are the cache's
	 * already: no file was read again, and every file it has was read. An entry is written as it
	 * was read or made, never made again.
	 */
	save(): void {
		if (!this.added && this.kept.size === this.read.size) return;
		mkdirSync(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${Date.now()}.saving`;
		const lines = [JSON.stringify(this.version)];
		for (const [path, { hash, json }] of this.kept) {
			lines.push(`${JSON.stringify(path)}\t${hash}\t${json}`);
		}
		writeFileSync(temporary, `${lines.join("\n")}\n`);
		renameSync(temporary, this.file);
	}
}

/** The hash a file's text is kept by. */
export function textHash(text: string): string {
	return hash("sha1", text);
}

/**
 * What facts are read with: the hash of the reader's modules, every file in its directory, so an
 * unreleased change to it counts as much as a release; and the version of each parser it loads.
 */
export function readerVersion(directory: string): string {
	const code = createHash("sha1");
	const files = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map(({ name }) => name)
		.sort();
	for (const name of files) {
		code.update(name).update(readFileSync(join(directory, name)));
	}
	const parsers = readers.map((name) => {
		try {
			return `${name}@${require(`${name}/package.json`).version}`;
		} catch {
			return `${name}@-`;
		}
	});
	return [code.digest("hex"), ...parsers].join(" ");
}

/**
 * The entries of the cache's file: its first line the reader's version, then a line for each file,
 * its path as JSON, its text's hash and its facts' JSON, apart by tabs, which JSON writes escaped.
 * A cache of another version, or one no reading can use, holds nothing.
 */
function load(file: string, version: string): ReadonlyMap<string, Entry> {
	let lines: string[];
	try {
		lines = readFileSync(file, "utf8").split("\n");
	} catch {
		// No cache yet: every file is read.
		return new Map();
	}
	const entries = new Map<string, Entry>();
	try {
		if (JSON.parse(lines[0] ?? "") !== version) return entries;
		for (const line of lines.slice(1)) {
			if (line === "") continue;
			const pathEnd = line.indexOf("\t");
			const hashEnd = line.indexOf("\t", pathEnd + 1);
			const path: unknown = JSON.parse(line.slice(0, pathEnd));
			if (typeof path !== "string" || hashEnd === -1) return new Map();
			entries.set(path, {
				hash: line.slice(pathEnd + 1, hashEnd),
				json: line.slice(hashEnd + 1),
			});
		}
	} catch {
		// A line no save wrote: every file is read again.
		return new Map();
	}
	return entries;
}
