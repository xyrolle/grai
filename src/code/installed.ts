/**
 * The installed packages a source may import, which a reading follows as it follows any module, and
 * which may pass grai's on unseen, as their code is no source and its text is never tested. A
 * source imports one only by a specifier that starts with its name (`candidates.ts` reads every
 * file that may spell a specifier otherwise). So the specifiers a source left out may import a
 * package by are those that start with the name of a package installed in a `node_modules` it may
 * resolve from; each is resolved from it and followed, as reading the source would, and a source
 * that writes one that passes grai's on is read.
 */

import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { written } from "./candidates.ts";
import type { Listed } from "./listing.ts";
import type { Mapping } from "./mappings.ts";

/** The packages installed for a project, and the specifiers of them that the sources write. */
export class Installed {
	private readonly names = new Set<string>();
	private readonly mappings: readonly Mapping[];
	private readonly resolve: (
		source: string,
		importer: string,
	) => string | undefined;
	private readonly resolved = new Map<string, string | undefined>();

	/**
	 * The packages in each `node_modules` at or above the root, and in those the listing left out
	 * below it (`skipped`), a scope's among them, resolved as the project resolves an import.
	 */
	constructor(
		root: string,
		skipped: readonly string[],
		mappings: readonly Mapping[],
		resolve: (source: string, importer: string) => string | undefined,
	) {
		this.mappings = mappings;
		this.resolve = resolve;
		const directories = skipped.filter(
			(path) => basename(path) === "node_modules",
		);
		for (let directory = root; ; directory = dirname(directory)) {
			directories.push(join(directory, "node_modules"));
			if (dirname(directory) === directory) break;
		}
		for (const modules of directories) {
			for (const name of entriesOf(modules)) {
				if (name.startsWith(".")) continue;
				if (!name.startsWith("@")) this.names.add(name);
				else {
					for (const scoped of entriesOf(join(modules, name))) {
						this.names.add(`${name}/${scoped}`);
					}
				}
			}
		}
	}

	/**
	 * The specifiers of installed packages that these sources write and whose modules pass grai's
	 * on, by `holds`, each as a pattern of the text that writes it.
	 */
	async passing(
		sources: readonly Listed[],
		holds: (path: string) => Promise<boolean>,
	): Promise<Set<string>> {
		const held = new Map<string, Promise<boolean>>();
		const passing = new Set<string>();
		for (const { path, specifiers } of sources) {
			for (const specifier of specifiers) {
				if (!this.imports(specifier)) continue;
				if (passing.has(specifier)) continue;
				const module = this.resolvedFrom(specifier, path);
				if (module === undefined) continue;
				let holding = held.get(module);
				if (holding === undefined) {
					holding = holds(module);
					held.set(module, holding);
				}
				if (await holding) passing.add(specifier);
			}
		}
		return new Set([...passing].map(written));
	}

	/**
	 * Where a specifier resolves from a file. A package's name resolves alike from every file in a
	 * directory, through the `node_modules` at and above it, unless a mapping, which a tsconfig may
	 * apply to some of them alone, takes it.
	 */
	private resolvedFrom(
		specifier: string,
		importer: string,
	): string | undefined {
		const mapped = this.mappings.some(({ key }) => {
			const star = key.indexOf("*");
			return star === -1
				? key === specifier
				: specifier.startsWith(key.slice(0, star)) &&
						specifier.endsWith(key.slice(star + 1));
		});
		const memo = `${mapped ? importer : dirname(importer)}\0${specifier}`;
		if (!this.resolved.has(memo)) {
			this.resolved.set(memo, this.resolve(specifier, importer));
		}
		return this.resolved.get(memo);
	}

	/** Whether a specifier names an installed package's module, by the package's name. */
	imports(specifier: string): boolean {
		const segments = specifier.split("/");
		const name = specifier.startsWith("@")
			? segments.slice(0, 2).join("/")
			: segments[0];
		return name !== undefined && this.names.has(name);
	}
}

function entriesOf(directory: string): string[] {
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
}
