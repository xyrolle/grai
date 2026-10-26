/**
 * Which sources may name a module outside the listed ones, which a reading follows as it follows
 * any module, and which may pass grai's on unseen: a module beside the roots, in a directory the
 * listing leaves out, or anywhere on disk. A specifier names one only as:
 * - an absolute path to an entry of the system's root, or a `file:` URL;
 * - a path that climbs out of the root its directory is listed under, by segments `..`: a relative
 *   path from its file's directory, or a path through a mapping with `*`, which writes its key, from
 *   its target's directory;
 * - or a name that leads there (`outsideNames`): a directory the listing leaves out, the key of a
 *   mapping whose target is outside the listed sources, or a symlink to outside them.
 * A specifier is one string in quotes, which holds no line break and spells its path as it is
 * (`candidates.ts` reads every file that may spell one otherwise). Climbing out of a directory `d`
 * levels below its root takes `d + 1` segments `..` in it, so a file none of whose lines holds that
 * many climbs out of none. Like the rest of the text test, it is necessary, never sufficient.
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

/** A segment `..`: between a separator, a quote or a line's start, and one of those or its end. */
const parent = /(?<![^\n\\/'"])\.\.(?![^\n\\/'"])/g;

/** A mapping with `*` that climbs out of the listed sources: its key, and the segments it takes. */
type Climb = { key: string; climbs: number };

/** The test of a source's text for a path that may name a module outside the listed sources. */
export class Outside {
	private readonly absolute: RegExp;
	private readonly roots: readonly string[];
	private readonly mapped: Climb[] = [];

	constructor(listing: Listing, mappings: readonly Mapping[]) {
		const systemRoots = new Set(listing.roots.map((root) => parse(root).root));
		const entries = [...systemRoots].flatMap((root) => readdirSync(root));
		// A path to the system's root itself names a module where it holds an index or a package.
		const module = entries.some(
			(entry) => entry === "package.json" || entry.startsWith("index."),
		);
		const named = [
			...entries.map((entry) => `${written(entry)}(?![\\w.-])`),
			...(module ? ["\\.{0,2}['\"]"] : []),
		];
		this.absolute = new RegExp(
			`['"](?:file:|(?:[A-Za-z]:)?[\\\\/](?:\\.{0,2}[\\\\/])*(?:${named.length === 0 ? "(?!)" : named.join("|")}))`,
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
					this.mapped.push({ key: key.slice(0, star), climbs: depth + 1 });
				}
			}
		}
	}

	/** Whether a listed source's text may name a module outside the listed sources by its path. */
	test(path: string, text: string): boolean {
		if (this.absolute.test(text)) return true;
		const root = this.roots.find((each) => within(path, each));
		const below = root === undefined ? "" : relative(root, dirname(path));
		const depth = below === "" ? 0 : below.split(sep).length;
		return climbs(text, depth + 1, this.mapped);
	}
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

/**
 * Whether some line of a text holds the segments `..` that climb out: `own` of them, or those of a
 * mapping on a line that writes its key.
 */
function climbs(text: string, own: number, mapped: readonly Climb[]): boolean {
	const fewest = Math.min(own, ...mapped.map((each) => each.climbs));
	let line = -2;
	let count = 0;
	for (const { index } of text.matchAll(parent)) {
		const start = text.lastIndexOf("\n", index);
		if (start !== line) {
			line = start;
			count = 0;
		}
		count += 1;
		if (count < fewest) continue;
		if (count >= own) return true;
		const end = text.indexOf("\n", index);
		const held = text.slice(start + 1, end === -1 ? text.length : end);
		const through = ({ key, climbs }: Climb) =>
			count >= climbs && held.includes(key);
		if (mapped.some(through)) return true;
	}
	return false;
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
