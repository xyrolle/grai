import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A value import of one of grai's modules by another, as grai's modules write them and its build
 * keeps them: `import … from "./x.ts"` or `export … from "../y.js"`, at the start of a line. A
 * type's import is left out, as Node and the build erase it.
 */
const moduleImport =
	/^(?:import|export)(?!\s+type\b)\b[^;"'`]*?\bfrom\s*"(\.\.?\/[^"]+)"/gm;

/**
 * The modules a compile runs and a saved build is read by, each by its path with its bytes as
 * they are on disk: saved-build's module, which imports the compiler's, and every module they
 * import in turn. Not the adapters', the CLI's or the rest of the package's, none of which a
 * compile runs.
 */
export function compilerModules(): Map<string, Buffer> {
	const here = fileURLToPath(import.meta.url);
	// Its own extension: `.ts` in grai's source, `.js` as published.
	const entry = join(dirname(here), `saved-build${extname(here)}`);
	const modules = new Map<string, Buffer>();
	const unread = [entry];
	for (let file = unread.pop(); file !== undefined; file = unread.pop()) {
		if (modules.has(file)) continue;
		const bytes = readFileSync(file);
		modules.set(file, bytes);
		for (const [, specifier] of bytes.toString("utf8").matchAll(moduleImport))
			if (specifier !== undefined) unread.push(join(dirname(file), specifier));
	}
	return modules;
}

/**
 * The compiler's identity: its modules (`compilerModules`), hashed with `copied`, the texts the
 * output copies, which are the runtime's modules and the templates of its declarations. A new
 * version of grai changes it, and so does a local change to any of them, which keeps the version.
 */
export function compilerIdentity(copied: readonly string[]): string {
	const root = dirname(fileURLToPath(import.meta.url));
	const modules = [...compilerModules()].sort(([a], [b]) => (a < b ? -1 : 1));
	const digest = createHash("sha1");
	for (const [file, bytes] of modules)
		digest.update(relative(root, file)).update("\0").update(bytes).update("\0");
	for (const text of copied) digest.update(text).update("\0");
	return digest.digest("hex");
}
