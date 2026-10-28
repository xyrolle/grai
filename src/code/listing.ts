/**
 * The project's source files, listed as `sources.ts` lists them, each known by its stat, so that a
 * command reads only the files that changed since the last. A file whose size, modification time,
 * change time and inode are what the listing kept is taken as unchanged: its text's hash, and what
 * the text test needs from its text (`specifiersIn`, `spellsOtherwise`), are the kept ones, and its
 * text is read only when a reading asks for it. A tool may set a file's modification time back, but
 * never its change time, which the system sets on every change.
 *
 * Git's rule for a racy entry keeps that exact. A file changed within `tick` of when it was read may
 * change again within the same tick of its times, unseen by them, so the next command reads it by
 * its content. A file changed earlier than that changes its times with any later change.
 */

import { type BigIntStats, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { type Seen, sourcePaths } from "../sources.ts";
import { specifiersIn, spellsOtherwise } from "./candidates.ts";
import { textHash } from "./facts-cache.ts";
import type { StateStore } from "./state-store.ts";

/**
 * The time within which a file's times may not tell two of its texts apart: two seconds, the
 * resolution of a FAT volume's modification time, the coarsest a system keeps.
 */
const tick = 2_000;

/** The name the listing is kept under in its store. */
const listingName = "files";

/** A source file, with what the listing knows of it. */
export type Listed = {
	readonly path: string;
	/** The path the project shows: relative to its root. */
	readonly file: string;
	/** Its text's hash (`textHash`), which its facts are kept by. */
	readonly hash: string;
	/** Its text, read when first asked for. */
	readonly text: string;
	/** The specifiers its text loads (`specifiersIn`). */
	readonly specifiers: readonly string[];
	/** Whether its text may spell a specifier otherwise (`spellsOtherwise`). */
	readonly unwritten: boolean;
};

/**
 * What the listing keeps of a file: its size, modification time, change time and inode, when it
 * read the file (ms), its text's hash, whether the text may spell a specifier otherwise, and the
 * specifiers it loads.
 */
type Kept = [string, string, string, string, number, string, boolean, string[]];

export class FileListing {
	private readonly store: StateStore;
	private readonly version: string;
	private readonly read: ReadonlyMap<string, Kept>;
	private readonly kept = new Map<string, Kept>();
	private changed = false;

	/** The listing its store keeps (`stateFiles`), for facts read with `version`, or an empty one. */
	constructor(store: StateStore, version: string) {
		this.store = store;
		this.version = version;
		this.read = load(store.read(listingName), version);
	}

	/**
	 * The source files under the roots, as `sourceFiles` lists them. The listing keeps what it
	 * kept of a file outside the roots, and drops a file gone from under them.
	 */
	async list(
		roots: readonly string[],
		projectRoot: string,
		outdir: string,
		seen: Seen,
	): Promise<Listed[]> {
		const paths = sourcePaths(roots, outdir, seen);
		// Every file's stat at once, on the system's threads, all taken after this time.
		const checked = Date.now();
		const stated = await Promise.all(
			paths.map(async (path) => ({
				path,
				stat: await stat(path, { bigint: true }),
			})),
		);
		const below = `${projectRoot}${sep}`;
		const listed = stated.map(({ path, stat }) => {
			const file = path.startsWith(below)
				? path.slice(below.length)
				: relative(projectRoot, path);
			return this.listed(path, file, stat, checked);
		});
		for (const [path, kept] of this.read) {
			if (this.kept.has(path)) continue;
			if (roots.some((root) => path.startsWith(`${root}/`))) {
				this.changed = true;
			} else {
				this.kept.set(path, kept);
			}
		}
		return listed;
	}

	/** Writes the listing, when a file was read again or is gone. */
	save(): void {
		if (!this.changed) return;
		const files = Object.fromEntries(this.kept);
		this.store.write(
			listingName,
			JSON.stringify({ version: this.version, files }),
		);
	}

	private listed(
		path: string,
		file: string,
		stat: BigIntStats,
		checked: number,
	): Listed {
		const known = this.read.get(path);
		if (known !== undefined && unchanged(known, stat)) {
			this.kept.set(path, known);
			const [, , , , , hash, unwritten, specifiers] = known;
			let text: string | undefined;
			return {
				path,
				file,
				hash,
				specifiers,
				unwritten,
				get text() {
					text ??= readFileSync(path, "utf8");
					return text;
				},
			};
		}
		const text = readFileSync(path, "utf8");
		const kept: Kept = [
			...signature(stat),
			checked,
			textHash(text),
			spellsOtherwise(text),
			specifiersIn(text),
		];
		this.kept.set(path, kept);
		this.changed = true;
		const [, , , , , hash, unwritten, specifiers] = kept;
		return { path, file, hash, text, specifiers, unwritten };
	}
}

/** A file's size, modification time, change time and inode, as the listing keeps them. */
function signature(stat: BigIntStats): [string, string, string, string] {
	return [
		String(stat.size),
		String(stat.mtimeNs),
		String(stat.ctimeNs),
		String(stat.ino),
	];
}

/**
 * Whether a file is unchanged since the listing read it: its stat is the one kept, and its times
 * were at least a tick older than that reading, so that no change since could have kept them.
 */
function unchanged(kept: Kept, stat: BigIntStats): boolean {
	const now = signature(stat);
	if (now.some((each, index) => each !== kept[index])) return false;
	const [, modified, changed, , checked] = kept;
	const latest = Number(
		BigInt(modified) > BigInt(changed) ? modified : changed,
	);
	return latest / 1e6 < checked - tick;
}

/** The listing kept, or none for another version or a text no save wrote. */
function load(
	text: string | undefined,
	version: string,
): ReadonlyMap<string, Kept> {
	// No listing yet: every file is read.
	if (text === undefined) return new Map();
	try {
		const value: unknown = JSON.parse(text);
		if (
			typeof value !== "object" ||
			value === null ||
			!("version" in value) ||
			value.version !== version ||
			!("files" in value) ||
			typeof value.files !== "object" ||
			value.files === null
		) {
			return new Map();
		}
		const kept = new Map<string, Kept>();
		for (const [path, entry] of Object.entries(value.files)) {
			if (!isKept(entry)) return new Map();
			kept.set(path, entry);
		}
		return kept;
	} catch {
		// A listing no save wrote: every file is read.
		return new Map();
	}
}

/** Whether a value is what a save keeps of a file. */
function isKept(value: unknown): value is Kept {
	if (!Array.isArray(value) || value.length !== 8) return false;
	const [size, modified, changed, inode, checked, hash, unwritten, specifiers] =
		value;
	return (
		[size, modified, changed, inode, hash].every(
			(each) => typeof each === "string",
		) &&
		typeof checked === "number" &&
		typeof unwritten === "boolean" &&
		Array.isArray(specifiers) &&
		specifiers.every((each) => typeof each === "string")
	);
}
