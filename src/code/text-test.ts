/**
 * The test a reading puts to the text of each file it has not read, round by round, as it finds the
 * barrels among what it read and the installed packages the rest import that pass grai's on. A file
 * is read when its text may name grai's output or a module that passes it on (`candidates.ts`), or
 * a module outside the listed sources (`outside.ts`), through a workspace package that passes it on
 * (`workspace.ts`) or an installed one (`installed.ts`). The test is necessary, never sufficient.
 *
 * A file names a module only by a specifier, a string right after a load's word, unless its text
 * may spell one otherwise (`unwritten`), which reads it. So the test takes each file's specifiers,
 * as the listing keeps them (`listing.ts`), and its text only through them.
 */

import { type Link, namesOf, type Package, written } from "./candidates.ts";
import { keyNamesOf } from "./key-candidates.ts";
import type { Listed } from "./listing.ts";
import type { Mapping } from "./mappings.ts";
import type { Output } from "./modules.ts";
import { type Listing, Outside, outsideNames } from "./outside.ts";
import { OutsidePackages } from "./workspace.ts";

/**
 * What the test reads a project's names from, and the key a reading is for alone, if any: then the
 * names are those of what may read or reach that key (`keyNamesOf`).
 */
export type Naming = {
	root: string;
	output: Output;
	key: string | undefined;
	listing: Listing;
	mappings: readonly Mapping[] | undefined;
	links: readonly Link[];
	packages: readonly Package[];
	/** The folders whose package.json may name a barrel as their entry. */
	entries: ReadonlySet<string>;
};

export class TextTest {
	private readonly naming: Naming;
	private readonly beyond: Outside;
	private readonly leaving: Set<string>;
	private readonly passers: OutsidePackages;
	/** The names the files were tested by, once they were: as they only grow, a file left out failed them. */
	private tested: ReadonlySet<string> | undefined;
	/** The test of an import's path by the names last tested, or undefined to take every import. */
	private leading: ((source: string) => boolean) | undefined;
	private readonly depths = new Map<string, number>();

	constructor(naming: Naming) {
		this.naming = naming;
		const { listing, mappings = [], links, packages, root } = naming;
		this.beyond = new Outside(listing, mappings);
		this.leaving = outsideNames(listing, mappings, links);
		this.passers = new OutsidePackages(packages, root);
	}

	/**
	 * The files among these whose text may read grai's, or reach the key, by the barrels found and
	 * the specifiers of installed packages that pass it on (`reached`); every one when a mapping may
	 * name the output from any specifier. A call after the first takes the files the calls before
	 * left out, which failed the names then, so it tests them by the names found since alone.
	 */
	taken(
		files: readonly Listed[],
		barrels: ReadonlySet<string>,
		reached: ReadonlySet<string>,
	): Listed[] {
		const { listing, mappings, links, packages, output, key, entries } =
			this.naming;
		const names =
			mappings &&
			(key === undefined
				? namesOf(
						{ outdir: listing.outdir, barrels, entries },
						mappings,
						links,
						packages,
					)
				: keyNamesOf(
						key,
						{ ...output, barrels, entries },
						mappings,
						links,
						packages,
					));
		if (names === undefined) {
			this.leading = undefined;
			return [...files];
		}
		for (const name of [...this.leaving, ...reached]) names.add(name);
		for (const name of this.passers.passing(names)) names.add(written(name));
		const tested = this.tested;
		this.tested = names;
		const leading = byName(new RegExp([...names].join("|")));
		this.leading = leading;
		if (tested === undefined) {
			return files.filter(({ path, unwritten, specifiers }) => {
				if (unwritten) return true;
				const depth = this.beyond.depth(path);
				return specifiers.some(
					(source) => leading(source) || this.beyond.leads(source, depth),
				);
			});
		}
		const found = [...names].filter((name) => !tested.has(name));
		if (found.length === 0) return [];
		const fresh = byName(new RegExp(found.join("|")));
		return files.filter(({ specifiers }) => specifiers.some(fresh));
	}

	/**
	 * Whether an import of a file read may name what holds grai's or a module outside the listed
	 * sources, by its path and the names the last call of `taken` tested by.
	 */
	leads(source: string, importer: string): boolean {
		if (this.leading === undefined || this.leading(source)) return true;
		let depth = this.depths.get(importer);
		if (depth === undefined) {
			depth = this.beyond.depth(importer);
			this.depths.set(importer, depth);
		}
		return this.beyond.leads(source, depth);
	}
}

/**
 * The test of a specifier by these names, in quotes as a text writes it, once for each specifier,
 * as many files write the same ones. A specifier that holds a quote or a line break, which would
 * end it within the quotes, is taken as one that may name anything.
 */
function byName(names: RegExp): (source: string) => boolean {
	const known = new Map<string, boolean>();
	return (source) => {
		let named = known.get(source);
		if (named === undefined) {
			named = /['"`\n\r\u2028\u2029]/.test(source) || names.test(`"${source}"`);
			known.set(source, named);
		}
		return named;
	};
}
