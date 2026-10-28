import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import type { Compiled } from "./compile.ts";
import { moduleOf } from "./output-paths.ts";
import { devKeysId, type ProjectFiles } from "./vite-dev.ts";

/**
 * What the resolver takes from grai's plugin: the project's files, the build the dev server serves,
 * and its `write`, which writes the first compile's output now if it is not written yet, with
 * whether it was not (`serveMessages`).
 */
export type UnwrittenOutput = {
	files: () => ProjectFiles;
	served: () => Compiled | undefined;
	write: () => Promise<boolean>;
};

/**
 * The dev server's resolver of the output's files while its first compile's output is not written:
 * Vite resolves an import by the file system, which does not have them yet, and the plugin serves
 * them from memory. It runs after Vite's resolver, on an import nothing resolved. One that names a
 * file of the output by its path resolves to that file, or to the dev module for keys.js: relative
 * to the module that imports it, absolute, as an alias makes it, or from the server's root, as a
 * module runner asks for a module by its URL. Another import from a module that may name the
 * output, as a package import does (`mayNameOutput`), has the output written now and is resolved
 * again once it is: only a written output resolves it. Any other is left to fail as it would, so
 * that a lookup Vite expects to fail, as of an entry a project lacks, never has the output written
 * while the first page waits. Once the output is written, it resolves nothing.
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
				const { outdir, keysFile } = dev.files();
				const files = dev.served()?.rendered.files ?? new Map();
				for (const path of pathsOf(id, importer, root)) {
					if (path === keysFile) return devKeysId;
					if (files.has(relative(outdir, path))) return path;
				}
				if (importer === undefined || !mayNameOutput(id, files)) return null;
				if (!(await dev.write())) return null;
				return this.resolve(id, importer, { ...options, skipSelf: true });
			},
		},
	};
}

/**
 * The files an import may name by its path: relative to the module that imports it, or an absolute
 * path, which a URL from the server's root may be too.
 */
function pathsOf(
	id: string,
	importer: string | undefined,
	root: string,
): string[] {
	if (isAbsolute(id)) return [id, join(root, id)];
	const relativeToImporter =
		(id.startsWith("./") || id.startsWith("../")) &&
		importer !== undefined &&
		isAbsolute(importer);
	return relativeToImporter ? [resolve(dirname(importer), id)] : [];
}

/**
 * Whether a specifier may name a file of the output by a mapping only a file there resolves: a
 * package import (`#…`), which names a module of the app, or one whose last segment is a file of
 * the output, as `messages.js` or `runtime.js`, or a key's own path, which an app maps to keys.js.
 */
function mayNameOutput(
	id: string,
	files: ReadonlyMap<string, string>,
): boolean {
	const last = id.slice(id.lastIndexOf("/") + 1);
	return id.startsWith("#") || files.has(last) || moduleOf(id).type === "key";
}
