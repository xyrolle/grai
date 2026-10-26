/**
 * Each file's facts kept on disk, in the outdir's `.grai/` state, which Git ignores already, so a
 * command reads again only the files that changed since the last. An entry is a file's facts, never
 * its tree, by the hash of its text, under the code that read it: grai's reader, by its contents,
 * and the versions of the parsers it loads, so any change to them reads every file again. The cache
 * is written whole and atomically after a command that read a file again or found one gone, with the
 * files that command read, so an entry for a file gone or changed is dropped. It is JSON, which V8
 * reads back in about half the time its own serializer takes for the same facts (75 MB of them, for
 * 9,000 files).
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

/** What the cache holds for a file: its text's hash, and its facts. */
type Entry = { hash: string; facts: FileFacts };

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

	/** A file's facts, if the cache has them for this text. */
	get(path: string, text: string): FileFacts | undefined {
		const entry = this.read.get(path);
		if (entry === undefined || entry.hash !== textHash(text)) return undefined;
		this.kept.set(path, entry);
		return entry.facts;
	}

	set(path: string, text: string, facts: FileFacts): void {
		this.kept.set(path, { hash: textHash(text), facts });
		this.added = true;
	}

	/**
	 * Writes the facts of the files read this time, and only those, unless they are the cache's
	 * already: no file was read again, and every file it has was read.
	 */
	save(): void {
		if (!this.added && this.kept.size === this.read.size) return;
		mkdirSync(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${Date.now()}.saving`;
		writeFileSync(
			temporary,
			JSON.stringify({ version: this.version, entries: [...this.kept] }),
		);
		renameSync(temporary, this.file);
	}
}

function textHash(text: string): string {
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

function load(file: string, version: string): ReadonlyMap<string, Entry> {
	let saved: unknown;
	try {
		saved = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		// No cache yet, or none a reading can use: every file is read again.
		return new Map();
	}
	if (
		typeof saved !== "object" ||
		saved === null ||
		!("version" in saved) ||
		saved.version !== version ||
		!("entries" in saved) ||
		!Array.isArray(saved.entries)
	) {
		return new Map();
	}
	return new Map(saved.entries);
}
