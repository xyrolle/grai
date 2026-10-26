/**
 * The packages a specifier may name by their own name and that hold the project's code: the project
 * itself, which its own package.json names, and each package its workspace links into a
 * `node_modules` at or above its root, whose real directory is outside every `node_modules`.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { sourceFiles } from "../sources.ts";
import { type Package, textTest } from "./candidates.ts";

export function workspacePackages(root: string): Package[] {
	const packages: Package[] = [];
	const own = nameOf(root);
	if (own !== undefined) packages.push({ name: own, directory: root });
	for (let directory = root; ; directory = dirname(directory)) {
		for (const link of linksIn(join(directory, "node_modules"))) {
			const real = realpathSync(link);
			const name = nameOf(real);
			if (!real.includes("/node_modules/") && name !== undefined) {
				packages.push({ name, directory: real });
			}
		}
		if (dirname(directory) === directory) return packages;
	}
}

/** The symlinks in a `node_modules`, a scope's among them. */
function linksIn(modules: string): string[] {
	const links: string[] = [];
	for (const entry of entriesOf(modules)) {
		const path = join(modules, entry.name);
		if (entry.isSymbolicLink()) links.push(path);
		else if (entry.name.startsWith("@") && entry.isDirectory()) {
			for (const scoped of entriesOf(path)) {
				if (scoped.isSymbolicLink()) links.push(join(path, scoped.name));
			}
		}
	}
	return links;
}

function entriesOf(directory: string) {
	try {
		return readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}

/** The name a directory's package.json gives, if any. */
function nameOf(directory: string): string | undefined {
	try {
		const value: unknown = JSON.parse(
			readFileSync(join(directory, "package.json"), "utf8"),
		);
		return typeof value === "object" &&
			value !== null &&
			"name" in value &&
			typeof value.name === "string"
			? value.name
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The workspace packages outside the project, whose files are no sources of its own but may pass
 * grai's on to it, as a barrel does: a package passes it on when any of its files' text may name
 * the output, a barrel, or a package that does.
 */
export class OutsidePackages {
	private readonly packages: { name: string; texts: () => string[] }[];

	constructor(packages: readonly Package[], root: string) {
		this.packages = packages
			.filter(({ directory }) => !`${directory}/`.startsWith(`${root}/`))
			.map(({ name, directory }) => {
				let texts: string[] | undefined;
				return {
					name,
					texts: () => {
						texts ??= sourceFiles([directory], directory, "").map(
							({ text }) => text,
						);
						return texts;
					},
				};
			});
	}

	/** The names of the packages that pass grai's on, from the names that may name it. */
	passing(names: ReadonlySet<string>): Set<string> {
		const passing = new Set<string>();
		for (let grown = true; grown; ) {
			grown = false;
			const test = textTest(new Set([...names, ...passing]));
			for (const { name, texts } of this.packages) {
				if (passing.has(name) || !texts().some((text) => test.test(text))) {
					continue;
				}
				passing.add(name);
				grown = true;
			}
		}
		return passing;
	}
}
