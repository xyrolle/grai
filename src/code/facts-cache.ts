/**
 * Each file's facts kept on disk, in the outdir's `.grai/` state, which Git ignores already, so a
 * command reads again only the files that changed since the last. An entry is a file's facts, never
 * its tree, by the hash of its text, under the code that read it: grai's reader, by its contents,
 * and the versions of the parsers it loads, so any change to them reads every file again. The cache
 * is written whole and atomically after a command that read a file again or found one gone. It keeps
 * the files that command read, and the entries of the files it left out unread or did not list,
 * outside its roots, so an entry for a file gone is dropped, and one for a file changed is replaced
 * when a command reads it. Each file's facts are
 * kept as text (`keptText`): JSON, which V8 reads back in about half the time its own serializer
 * takes for the same facts (75 MB of them, for 9,000 files), its modules' uses apart, so that a
 * reading parses only the uses it needs (`usesFrom`). A save writes each entry it kept as it was
 * read, so it makes no file's text again.
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
import { type FileFacts, type ModuleFacts, table } from "./facts.ts";

/** What the cache holds for a file: its text's hash, and its facts' text (`keptText`). */
type Entry = { hash: string; kept: string };

/** A file's facts, read, and their text, which the cache keeps as it is. */
export type FactsRead = { facts: FileFacts; kept: string };

/**
 * What parts a kept file's uses (`keptText`): `unit` a module's index, an origin and the JSON of its
 * uses, and `record` one origin's from the next.
 */
const unit = "\u0001";
const record = "\u0002";

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
		return keptFacts(entry.kept);
	}

	set(path: string, hash: string, { kept }: FactsRead): void {
		this.kept.set(path, { hash, kept });
		this.added = true;
	}

	/**
	 * Keeps the entry of each file this command did not read: one it listed and left out, or one
	 * outside the roots it listed under. A file under them that it did not list is gone.
	 */
	keepUnread(roots: readonly string[], listed: ReadonlySet<string>): void {
		for (const [path, entry] of this.read) {
			if (this.kept.has(path)) continue;
			const under = roots.some((root) => path.startsWith(`${root}/`));
			if (!under || listed.has(path)) this.kept.set(path, entry);
		}
	}

	/**
	 * Writes the facts of the files read this time and those kept unread, unless they are the cache's
	 * already: no file was read again, and it keeps every entry it has. An entry is written as it
	 * was read or made, never made again.
	 */
	save(): void {
		if (!this.added && this.kept.size === this.read.size) return;
		mkdirSync(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.${Date.now()}.saving`;
		const lines = [JSON.stringify(this.version)];
		for (const [path, { hash, kept }] of this.kept) {
			lines.push(`${JSON.stringify(path)}\t${hash}\t${kept}`);
		}
		writeFileSync(temporary, `${lines.join("\n")}\n`);
		renameSync(temporary, this.file);
	}
}

/**
 * A file's facts as the cache keeps them: their JSON without the modules' uses, a tab, then each
 * module's uses of each origin as JSON, apart by control characters that JSON never writes as they
 * are. A reading parses the uses of an origin only once it needs them.
 */
export function keptText(facts: FileFacts): string {
	if ("error" in facts) return JSON.stringify(facts);
	const groups: string[] = [];
	const modules = facts.modules.map(({ uses, ...rest }, index): ModuleFacts => {
		for (const [origin, list] of Object.entries(uses)) {
			const json = typeof list === "string" ? list : JSON.stringify(list);
			groups.push([index, origin, json].join(unit));
		}
		return { ...rest, uses: {} };
	});
	return `${JSON.stringify({ modules })}\t${groups.join(record)}`;
}

/** A file's facts from the text the cache keeps them as (`keptText`), their uses left as JSON. */
export function keptFacts(kept: string): FileFacts {
	const tab = kept.indexOf("\t");
	if (tab === -1) return JSON.parse(kept);
	const facts: FileFacts = JSON.parse(kept.slice(0, tab));
	if ("error" in facts) return facts;
	for (const module of facts.modules) {
		module.uses = table();
		module.aliases = table(module.aliases);
	}
	if (tab === kept.length - 1) return facts;
	for (const group of kept.slice(tab + 1).split(record)) {
		const [index, origin, json] = group.split(unit);
		const module = facts.modules[Number(index)];
		if (module !== undefined && origin !== undefined && json !== undefined) {
			module.uses[origin] = json;
		}
	}
	return facts;
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
 * its path as JSON, its text's hash and its facts' text, apart by tabs, which JSON writes escaped.
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
				kept: line.slice(hashEnd + 1),
			});
		}
	} catch {
		// A line no save wrote: every file is read again.
		return new Map();
	}
	return entries;
}
