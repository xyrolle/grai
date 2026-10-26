/**
 * The test a reading puts to the text of each file it has not read, round by round, as it finds the
 * barrels among what it read and the installed packages the rest import that pass grai's on. A file
 * is read when its text may name grai's output or a module that passes it on (`candidates.ts`), or
 * a module outside the listed sources (`outside.ts`), through a workspace package that passes it on
 * (`workspace.ts`) or an installed one (`installed.ts`). The test is necessary, never sufficient.
 */

import type { SourceFile } from "../sources.ts";
import {
	type Link,
	namesOf,
	type Package,
	textTest,
	written,
} from "./candidates.ts";
import type { Mapping } from "./mappings.ts";
import { type Listing, Outside, outsideNames } from "./outside.ts";
import { OutsidePackages } from "./workspace.ts";

/** What the test reads a project's names from. */
export type Naming = {
	root: string;
	listing: Listing;
	mappings: readonly Mapping[] | undefined;
	links: readonly Link[];
	packages: readonly Package[];
};

export class TextTest {
	private readonly naming: Naming;
	private readonly beyond: Outside;
	private readonly leaving: Set<string>;
	private readonly passers: OutsidePackages;
	/** The names the files were tested by, once they were: as they only grow, a file left out failed them. */
	private tested: ReadonlySet<string> | undefined;

	constructor(naming: Naming) {
		this.naming = naming;
		const { listing, mappings = [], links, packages, root } = naming;
		this.beyond = new Outside(listing, mappings);
		this.leaving = outsideNames(listing, mappings, links);
		this.passers = new OutsidePackages(packages, root);
	}

	/**
	 * The files among these whose text may read grai's, by the barrels found and the specifiers of
	 * installed packages that pass it on (`reached`); every one when a mapping may name the output
	 * from any specifier. A call after the first takes the files the calls before left out, which
	 * failed the names then, so it tests them by the names found since alone.
	 */
	taken(
		files: readonly SourceFile[],
		barrels: ReadonlySet<string>,
		reached: ReadonlySet<string>,
	): SourceFile[] {
		const { listing, mappings, links, packages } = this.naming;
		const names =
			mappings &&
			namesOf({ outdir: listing.outdir, barrels }, mappings, links, packages);
		if (names === undefined) return [...files];
		for (const name of [...this.leaving, ...reached]) names.add(name);
		for (const name of this.passers.passing(names)) names.add(written(name));
		const tested = this.tested;
		this.tested = names;
		if (tested === undefined) {
			const test = textTest(names);
			return files.filter(
				({ path, text }) => test.test(text) || this.beyond.test(path, text),
			);
		}
		const found = [...names].filter((name) => !tested.has(name));
		if (found.length === 0) return [];
		const test = new RegExp(found.join("|"));
		return files.filter(({ text }) => test.test(text));
	}
}
