/**
 * Each file's facts kept on disk, in the outdir's `.grai/` state, which Git ignores already, so a
 * command reads again only the files that changed since the last. An entry is a file's facts, never
 * its tree, by the hash of its text, under the versions of grai and of the parsers that read it, so
 * any change to them reads every file again. The cache is written whole and atomically after a
 * command reads, with the files that command read, so an entry for a file gone or changed is dropped.
 */

import { hash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { FileFacts } from "./facts.ts";

/** What the cache holds for a file: its text's hash, and its facts. */
type Entry = { hash: string; facts: FileFacts };

/** The packages whose versions decide what a file's facts are: grai's parser and the frameworks'. */
const readers = ["oxc-parser", "svelte", "vue", "astro", "@mdx-js/mdx"];

const require = createRequire(import.meta.url);

export class FactsCache {
	private readonly file: string;
	private readonly read: ReadonlyMap<string, Entry>;
	private readonly kept = new Map<string, Entry>();

	/** The cache of a project's facts, in its outdir's state, or an empty one. */
	constructor(stateDirectory: string) {
		this.file = join(stateDirectory, "facts");
		this.read = load(this.file);
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
	}

	/** Writes the facts of the files read this time, and only those. */
	save(): void {
		mkdirSync(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${Date.now()}.saving`;
		writeFileSync(temporary, serialize({ version, entries: [...this.kept] }));
		renameSync(temporary, this.file);
	}
}

function textHash(text: string): string {
	return hash("sha1", text);
}

/** The versions the facts were read with, grai's and its readers'. */
const version = [
	require("../../package.json").version,
	...readers.map((name) => {
		try {
			return `${name}@${require(`${name}/package.json`).version}`;
		} catch {
			return `${name}@-`;
		}
	}),
].join(" ");

function load(file: string): ReadonlyMap<string, Entry> {
	let bytes: Buffer;
	try {
		bytes = readFileSync(file);
	} catch {
		return new Map();
	}
	const saved: unknown = deserialize(bytes);
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
