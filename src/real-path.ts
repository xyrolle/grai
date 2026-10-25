import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * A path as the bundler names a module: with its symlinks resolved, though its last parts, such as
 * an output not written yet, need not exist.
 */
export function realPath(path: string): string {
	if (existsSync(path)) return realpathSync(path);
	const parent = dirname(path);
	return parent === path ? path : join(realPath(parent), basename(path));
}
