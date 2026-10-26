/** Which import paths name a project's own keys.js, as check tells it from a module named keys too. */

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "./config.ts";

/**
 * Whether an import path names the project's keys.js: a relative path to it, a path the project's
 * package.json `imports` map to it, or an alias the bundler resolves, such as SvelteKit's `$lib`,
 * that ends in the output's own directory and `keys`.
 */
export function keysFileOf(
	config: Config,
): (specifier: string, importer: string) => boolean {
	const keysFile = join(resolve(config.root, config.outdir), "keys");
	const imports = packageImports(config.root);
	const tail = `${basename(config.outdir)}/keys`;
	return (specifier, importer) => {
		const target = specifier.startsWith(".")
			? resolve(dirname(importer), specifier)
			: specifier.startsWith("#")
				? importTarget(imports, specifier, config.root)
				: undefined;
		const named = target ?? specifier;
		const written = named.replace(/\.[cm]?[jt]s$/, "");
		return target === undefined ? written.endsWith(tail) : written === keysFile;
	};
}

/** The `imports` of the project's package.json, each a path by its specifier or pattern. */
function packageImports(root: string): ReadonlyMap<string, string> {
	try {
		const { imports } = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		);
		if (typeof imports !== "object" || imports === null) return new Map();
		return new Map(
			Object.entries(imports).flatMap(([pattern, target]) =>
				typeof target === "string" ? [[pattern, target]] : [],
			),
		);
	} catch {
		return new Map();
	}
}

/** The file a `#` import names through package.json, as Node maps it, or nothing. */
function importTarget(
	imports: ReadonlyMap<string, string>,
	specifier: string,
	root: string,
): string | undefined {
	const exact = imports.get(specifier);
	if (exact !== undefined) return resolve(root, exact);
	for (const [pattern, target] of imports) {
		const [prefix = "", suffix] = pattern.split("*");
		if (suffix === undefined) continue;
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
		const matched = specifier.slice(
			prefix.length,
			specifier.length - suffix.length,
		);
		return resolve(root, target.replace("*", matched));
	}
	return undefined;
}
