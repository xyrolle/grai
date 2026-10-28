import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import type { CompiledProject } from "./compile.ts";
import { devKeysId, type ProjectFiles } from "./vite-dev.ts";

/**
 * What the resolver takes from grai's plugin: the project's files, the build the dev server serves,
 * and its `write`, which writes the first compile's output now if it is not written yet, with
 * whether it was not (`serveMessages`).
 */
export type UnwrittenOutput = {
	files: () => ProjectFiles;
	served: () => CompiledProject | undefined;
	write: () => Promise<boolean>;
};

/** The prefix of the id Vite's dependency scan gets for a file of the output not written yet. */
const scannedPrefix = "\0grai:unwritten:";

/**
 * The dev server's resolver of the output's files while its first compile's output is not written:
 * Vite resolves an import by the file system, which does not have them yet, and the plugin serves
 * them from memory. It runs after Vite's resolver, on an import nothing resolved. One that names a
 * file the plugin serves by its path, with or without its `.js`, resolves to that file, or to the
 * dev module for keys.js: the path relative to the module that imports it, absolute, as an alias
 * makes it, from the server's root, as a module runner asks for a module by its URL, or as the
 * package's `imports` map a package import to a path (`packageImportPath`). Any other import from
 * a module, as one with a query (`?raw`) or by a mapping only the file system resolves, as a
 * tsconfig's paths, has the output written now, and is resolved again once it is. Vite's dependency
 * scan reads the files it is given from the disk: it gets the output as an import it leaves out,
 * since the output imports no dependency. A module with a glob (`import.meta.glob`), which Vite
 * expands from the disk, waits for the output to be written. Once it is written, an import nothing
 * resolved fails as it would.
 */
export function unwrittenOutput(dev: UnwrittenOutput): Plugin {
	let root = "";
	return {
		name: "grai:unwritten-output",
		apply: "serve",
		configResolved(config) {
			root = config.root;
		},
		resolveId: {
			order: "post",
			async handler(id, importer, options) {
				const served = dev.served();
				if (served === undefined || id.startsWith("\0")) return null;
				const { outdir, keysFile } = dev.files();
				const query = id.indexOf("?");
				const named = pathsOf(
					query === -1 ? id : id.slice(0, query),
					importer,
					root,
				);
				const output = named.filter((path) => isInside(outdir, path));
				// Vite's dependency scan marks its calls with `scan`, which its types keep internal.
				const scanning = "scan" in options && options.scan === true;
				// A path outside the output is not the plugin's to resolve.
				if (named.length > 0 && output.length === 0) return null;
				for (const path of query === -1 ? output : []) {
					const file = [path, `${path}.js`].find(
						(candidate) =>
							candidate === keysFile ||
							served.rendered.files.has(relative(outdir, candidate)),
					);
					if (file === undefined) continue;
					const resolved = file === keysFile ? devKeysId : file;
					return scanning
						? { id: `${scannedPrefix}${resolved}`, external: true }
						: resolved;
				}
				if (importer === undefined || (scanning && output.length > 0))
					return null;
				if (!(await dev.write())) return null;
				return this.resolve(id, importer, { ...options, skipSelf: true });
			},
		},
		transform: {
			order: "pre",
			filter: { code: "import.meta.glob" },
			async handler() {
				await dev.write();
				return null;
			},
		},
	};
}

/** Whether a path is inside a directory. */
function isInside(directory: string, path: string): boolean {
	const name = relative(directory, path);
	return name !== "" && !name.startsWith("..") && !isAbsolute(name);
}

/**
 * The files an import may name by its path: relative to the module that imports it, an absolute
 * path, which a URL from the server's root may be too, or a package import's path.
 */
function pathsOf(
	id: string,
	importer: string | undefined,
	root: string,
): string[] {
	if (isAbsolute(id)) return [id, join(root, id)];
	if (importer === undefined || !isAbsolute(importer)) return [];
	if (id.startsWith("./") || id.startsWith("../"))
		return [resolve(dirname(importer), id)];
	if (!id.startsWith("#")) return [];
	const path = packageImportPath(id, importer);
	return path === undefined ? [] : [path];
}

/**
 * The file a package import (`#…`) names by the `imports` of the package of the module that imports
 * it: its exact entry, else the pattern with the longest part before its `*`, as Node and Vite
 * match them. Only a target that is a path names a file without the file system: for one by
 * conditions, it is undefined, and the import resolves once the output is written.
 */
function packageImportPath(id: string, importer: string): string | undefined {
	for (let directory = dirname(importer); ; directory = dirname(directory)) {
		const imports = importsOf(join(directory, "package.json"));
		if (imports !== undefined) {
			const [target, subpath] = matched(imports, id) ?? [];
			return typeof target === "string" &&
				target.startsWith("./") &&
				subpath !== undefined
				? resolve(directory, target.replaceAll("*", subpath))
				: undefined;
		}
		if (dirname(directory) === directory) return undefined;
	}
}

/** A package.json's `imports`, empty if it has none; undefined if there is no package.json. */
function importsOf(manifest: string): object | undefined {
	let text: string;
	try {
		text = readFileSync(manifest, "utf8");
	} catch {
		return undefined;
	}
	const parsed: unknown = JSON.parse(text);
	const imports =
		typeof parsed === "object" && parsed !== null && "imports" in parsed
			? parsed.imports
			: undefined;
	return typeof imports === "object" && imports !== null ? imports : {};
}

/** The target an `imports` map gives an id, and what its pattern's `*` stands for in the id. */
function matched(
	imports: object,
	id: string,
): [target: unknown, subpath: string] | undefined {
	const entries = Object.entries(imports);
	const exact = entries.find(([key]) => key === id && !key.includes("*"));
	if (exact !== undefined) return [exact[1], ""];
	let best: { target: unknown; subpath: string; prefix: number } | undefined;
	for (const [key, target] of entries) {
		const star = key.indexOf("*");
		if (star === -1 || star !== key.lastIndexOf("*")) continue;
		const suffix = key.slice(star + 1);
		if (
			id.length >= key.length &&
			id.startsWith(key.slice(0, star)) &&
			id.endsWith(suffix) &&
			(best === undefined || star > best.prefix)
		)
			best = {
				target,
				subpath: id.slice(star, id.length - suffix.length),
				prefix: star,
			};
	}
	return best === undefined ? undefined : [best.target, best.subpath];
}
