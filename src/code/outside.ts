/**
 * Which sources may name a module outside the listed ones, which a reading follows as it follows
 * any module, and which may pass grai's on unseen: a module beside the roots, in a directory the
 * listing leaves out, or anywhere on disk. A specifier names one only as:
 * - an absolute path to an entry of the system's root, or a `file:` URL;
 * - a path that climbs out of the root its directory is listed under, by segments `..`: a relative
 *   path from its file's directory, or a path through a mapping with `*`, which starts with its key,
 *   from its target's directory;
 * - or a name that leads there (`outsideNames`): a directory the listing leaves out, the key of a
 *   mapping whose target is outside the listed sources, or a symlink to outside them.
 * A specifier spells its path as it is (`candidates.ts` reads every file that may spell one
 * otherwise), so each is judged by its own segments. Like the rest of the text test, it is
 * necessary, never sufficient.
 */

import { readdirSync } from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	parse,
	relative,
	sep,
} from "node:path";
import { type Link, written } from "./candidates.ts";
import type { Mapping } from "./mappings.ts";

/** Where the listed sources are: their roots, less the directories the listing leaves out. */
export type Listing = {
	roots: readonly string[];
	skipped: readonly string[];
	outdir: string;
};

/** A mapping with `*` whose paths may climb out of the listed sources: its key, and its depth. */
type Climb = { key: string; depth: number };

/** The test of a specifier for a path that may name a module outside the listed sources. */
export class Outside {
	private readonly roots: readonly string[];
	private readonly entries: ReadonlySet<string>;
	/** Whether the system's root holds a module, an index or a package, that a path to it names. */
	private readonly rootModule: boolean;
	private readonly mapped: Climb[] = [];

	constructor(listing: Listing, mappings: readonly Mapping[]) {
		const systemRoots = new Set(listing.roots.map((root) => parse(root).root));
		const entries = [...systemRoots].flatMap((root) => readdirSync(root));
		this.entries = new Set(entries);
		this.rootModule = entries.some(
			(entry) => entry === "package.json" || entry.startsWith("index."),
		);
		this.roots = listing.roots;
		for (const { key, targets } of mappings) {
			const star = key.indexOf("*");
			if (star === -1) continue;
			for (const target of targets) {
				const at = target.indexOf("*");
				if (!isAbsolute(target) || at === -1) continue;
				// The directory the text `*` takes starts in.
				const directory = dirname(`${target.slice(0, at)}_`);
				// Out of the output, which no root lists, any segment `..` may climb.
				const depth = within(directory, listing.outdir)
					? 0
					: depthIn(listing, directory);
				if (depth !== undefined) {
					this.mapped.push({ key: key.slice(0, star), depth });
				}
			}
		}
	}

	/** How many directories a listed source is below the root it is listed under. */
	depth(path: string): number {
		const root = this.roots.find((each) => within(path, each));
		const below = root === undefined ? "" : relative(root, dirname(path));
		return below === "" ? 0 : below.split(sep).length;
	}

	/**
	 * Whether a specifier of a source `depth` directories below its root may name a module outside
	 * the listed sources by its path.
	 */
	leads(source: string, depth: number): boolean {
		if (source.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(source)) {
			return true;
		}
		if (/^[\\/]/.test(source)) {
			// From the system's root, `..` stays there, so the first other segment is what it names.
			const first = segments(source).find((each) => each !== "..");
			return first === undefined ? this.rootModule : this.entries.has(first);
		}
		if (source.startsWith(".") && climbsOut(source, depth)) return true;
		return this.mapped.some(
			(each) =>
				source.startsWith(each.key) &&
				climbsOut(source.slice(each.key.length), each.depth),
		);
	}
}

/** A path's segments, by either separator, without the empty ones and `.`, which name no step. */
function segments(path: string): string[] {
	return path.split(/[\\/]/).filter((each) => each !== "" && each !== ".");
}

/** Whether a path from a directory `depth` levels below its root climbs out of it at some step. */
function climbsOut(path: string, depth: number): boolean {
	let level = depth;
	for (const each of segments(path)) {
		level += each === ".." ? -1 : 1;
		if (level < 0) return true;
	}
	return false;
}

/**
 * The names that lead outside the listed sources: the directories the listing leaves out, the keys
 * of mappings whose targets are outside them (a `*` key's empty, which every text holds), and
 * symlinks to outside them. A target or link in the output is a destination, which the names of
 * `candidates.ts` judge.
 */
export function outsideNames(
	listing: Listing,
	mappings: readonly Mapping[],
	links: readonly Link[],
): Set<string> {
	const names = new Set(listing.skipped.map((path) => written(basename(path))));
	const leads = (path: string) =>
		depthIn(listing, path) === undefined && !within(path, listing.outdir);
	for (const { key, targets } of mappings) {
		const leaving = targets.some((target) => {
			// A target that is a specifier is a name of `candidates.ts`.
			if (!isAbsolute(target)) return false;
			const star = target.indexOf("*");
			return leads(star === -1 ? target : dirname(`${target.slice(0, star)}_`));
		});
		if (leaving) names.add(written(key.split("*")[0] ?? key));
	}
	for (const { path, real } of links) {
		if (leads(real)) names.add(written(basename(path, extname(path))));
	}
	return names;
}

/** How many directories a path is below the root it is listed under, or undefined if unlisted. */
function depthIn(
	{ roots, skipped, outdir }: Listing,
	path: string,
): number | undefined {
	if (within(path, outdir) || skipped.some((each) => within(path, each))) {
		return undefined;
	}
	const root = roots.find((each) => within(path, each));
	if (root === undefined) return undefined;
	const below = relative(root, path);
	return below === "" ? 0 : below.split(sep).length;
}

/** Whether a path is a directory or below it. */
function within(path: string, directory: string): boolean {
	return path === directory || path.startsWith(`${directory}/`);
}
