/**
 * Which source files may read grai's messages, by their text alone, so that only they are parsed
 * and resolved. A file reads them only through an import, a load or a glob that names grai's output
 * or a module that passes it on (a barrel), so its text must hold what names one:
 * - the output directory's name, or a barrel's: its file's, its folder's too for an index, or that
 *   of a folder above it whose package.json may name it as its entry, as a path through them writes
 *   it; or a path whose last segment is `.` or `..`, which names a folder without its name;
 * - the key of a mapping (`mappings.ts`) that may name one without that name, such as an alias of
 *   the output itself, or the name of a symlink or of a package that holds one;
 * - or what may spell any specifier otherwise (`unwritten`): an escape in one, or a load or a glob
 *   by a path built at run time, which may take the output in without naming it.
 * The test is necessary, never sufficient: a file that fails it reads nothing of grai's, so reading
 * only the files that pass it reads what reading every file reads.
 */

import { basename, dirname, extname, isAbsolute } from "node:path";
import type { Mapping } from "./mappings.ts";

/**
 * What a specifier may name and hold grai's: the output directory, and each barrel module, with the
 * folders whose package.json may name a barrel as their entry (`entries`), as a path to such a
 * folder resolves to its entry.
 */
export type Destinations = {
	outdir: string;
	barrels: ReadonlySet<string>;
	entries: ReadonlySet<string>;
};

/** A symlink, by its path and the real path it names. */
export type Link = { path: string; real: string };

/** A package, by its name and its directory's real path. */
export type Package = { name: string; directory: string };

/**
 * What may spell a specifier the text does not write as it is. A specifier is a string in quotes
 * right after `from`, `import`, `import(` or `require(`, so what may spell one otherwise is:
 * - a comment there, which may hide one;
 * - an escape in one, which may stand for a name's character (`\s` stands for `s`);
 * - `\u` anywhere, as an identifier may spell `require` or `glob` with one;
 * - a load whose argument is anything but one whole string, as a template or a sum of strings
 *   builds its path at run time;
 * - and a glob.
 */
const unwritten =
	/\\u|\b(?:from|import|require)\s*(?:\(\s*)?(?:\/[*/]|'[^'\n\\]*\\|"[^"\n\\]*\\)|\b(?:import|require)\s*\((?!\s*(?:'[^'\n]*'|"[^"\n]*")\s*\))|\bglob\s*(?:\(|<|\/[*/])/;

/** Whether a text may spell a specifier otherwise than as it writes it (`unwritten`). */
export function spellsOtherwise(text: string): boolean {
	return unwritten.test(text);
}

/** A specifier where `unwritten` finds none spelled otherwise: a string right after a load's word. */
const specifier =
	/\b(?:from|import|require)\s*(?:\(\s*)?(?:'([^'\n\\]*)'|"([^"\n\\]*)")/g;

/** The specifiers a text that passes no `unwritten` test loads, each as it reads. */
export function specifiersIn(text: string): string[] {
	return Array.from(
		text.matchAll(specifier),
		([, single, double]) => single ?? double ?? "",
	);
}

/**
 * A key's path, as `output-paths.ts` takes one: `messages/` and a key's name, maybe with an
 * extension, that end a specifier. An import of one that nothing resolves is the output's, whose
 * reads are unknown, so a file that writes one is read whatever it names.
 */
export const keyPath: string = String.raw`(?:['"]|\/)messages\/[A-Za-z_$][\w$]*(?:\.[cm]?[jt]s)?['"]`;

/** The test a file's text must pass to be read, from the names that may name a destination. */
export function textTest(names: ReadonlySet<string>): RegExp {
	return new RegExp([unwritten.source, ...names].join("|"));
}

/** A name as a text writes it, as the source of a pattern. */
export function written(name: string): string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every name a specifier that names a destination must write, and a key's path, or undefined when a
 * mapping may name one from any specifier, such as a `*` key, so that every file is read.
 */
export function namesOf(
	destinations: Destinations,
	mappings: readonly Mapping[],
	links: readonly Link[],
	packages: readonly Package[],
): Set<string> | undefined {
	const names = new Set([
		written(basename(destinations.outdir)),
		keyPath,
		dotted,
	]);
	for (const barrel of destinations.barrels) {
		for (const name of barrelNames(barrel, destinations.entries)) {
			names.add(written(name));
		}
	}
	const lands = (path: string) => landsOn(path, destinations);
	for (const { key, targets } of mappings) {
		const star = key.indexOf("*");
		const fixed = star === -1 ? key : key.slice(0, star);
		const named = targets.some((target) =>
			star === -1
				? namesExactly(target, lands)
				: namesBelow(target, destinations),
		);
		if (!named) continue;
		if (fixed === "") return undefined;
		names.add(written(fixed));
	}
	for (const { path, real } of links) {
		if (lands(real)) names.add(written(basename(path, extname(path))));
	}
	for (const { name, directory } of packages) {
		const inside = [destinations.outdir, ...destinations.barrels].some(
			(destination) => destination.startsWith(`${directory}/`),
		);
		if (inside) names.add(written(name));
	}
	return names;
}

/**
 * A path whose last segment is `.` or `..`, which names a folder, and so its index or entry,
 * without writing the folder's name.
 */
export const dotted: string = String.raw`(?:['"]|\/)\.\.?\/?['"]`;

/**
 * The names a path to a barrel may end in: its file's, its folder's for an index, and those of the
 * folders above it whose package.json may name it as their entry (`entries`).
 */
export function barrelNames(
	barrel: string,
	entries: ReadonlySet<string>,
): string[] {
	const stem = basename(barrel, extname(barrel));
	const names = [stem];
	if (stem === "index") names.push(basename(dirname(barrel)));
	for (const entry of entries) {
		if (barrel.startsWith(`${entry}/`)) names.push(basename(entry));
	}
	return names;
}

/**
 * Whether a path names a module file: the file, its path without an extension, an index's folder,
 * or a folder above it whose package.json may name it as its entry.
 */
export function pathNames(
	path: string,
	file: string,
	entries: ReadonlySet<string>,
): boolean {
	const stem = file.slice(0, file.length - extname(file).length);
	if (path === file || path === stem) return true;
	if (basename(stem) === "index" && path === dirname(file)) return true;
	return entries.has(path) && file.startsWith(`${path}/`);
}

/** Whether a mapping without `*` may name a destination: its target lands on one, or is a specifier. */
function namesExactly(
	target: string,
	lands: (path: string) => boolean,
): boolean {
	return !isAbsolute(target) || target.includes("*") || lands(target);
}

/**
 * Whether a mapping with `*` may name a destination without the specifier writing its name: the
 * text that `*` takes (the specifier's own) holds a destination's name only when the target puts it
 * at the start of a segment, below what the target fixes, and the rest of the target names no
 * further segment.
 */
function namesBelow(target: string, destinations: Destinations): boolean {
	if (!isAbsolute(target)) return true;
	const star = target.indexOf("*");
	if (star === -1) return landsOn(target, destinations);
	const fixed = target.slice(0, star);
	if (target.slice(star + 1).includes("/")) return true;
	const { outdir, barrels } = destinations;
	if (fixed === `${outdir}/` || fixed.startsWith(`${outdir}/`)) return true;
	const split = !fixed.endsWith("/");
	return (
		split &&
		[outdir, ...barrels].some((destination) => destination.startsWith(fixed))
	);
}

/** Whether a path names a destination: in the output directory, or a barrel's module. */
function landsOn(
	path: string,
	{ outdir, barrels, entries }: Destinations,
): boolean {
	if (path === outdir || path.startsWith(`${outdir}/`)) return true;
	return [...barrels].some((barrel) => pathNames(path, barrel, entries));
}
