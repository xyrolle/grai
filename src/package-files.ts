// Where grai's own files are, for the modules that read one or run one: grai's directory, `src` in
// its repository and `dist` as published, and the extension of its modules there. This is the one
// module that takes its own location. grai's build bundles its modules, and gives this one a chunk
// of its own at the root of dist, so a module finds grai's files from here wherever the bundle puts
// its code.
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/** grai's directory. */
export const packageDirectory: URL = new URL("./", import.meta.url);

/** This module's file, which grai's build lists among the compiler's (`builtModules`). */
export const packageFilesModule: string = fileURLToPath(import.meta.url);

/** The extension of grai's modules: `.ts` in its source, `.js` as built. */
const extension = extname(packageFilesModule);

/** A file of grai's directory, by its path in it: `runtime/runtime.js`. */
export function packageFile(path: string): URL {
	return new URL(path, packageDirectory);
}

/** A module of grai's, by its path in grai's directory without its extension: `next/watch-worker`. */
export function packageModule(path: string): URL {
	return packageFile(`${path}${extension}`);
}
