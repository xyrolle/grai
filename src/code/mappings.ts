/**
 * Every mapping a specifier may go through before it names a path: the project's Vite aliases, its
 * tsconfig's `paths`, and the `imports` of its package.json files. `candidates.ts` reads them to
 * tell which specifiers may name grai's output without naming its path.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Resolution } from "./resolution.ts";
import { tsconfigPaths } from "./tsconfig-paths.ts";

/**
 * A specifier's mapping: a key, with at most one `*` for any text, and what it maps to. A target is
 * an absolute path, `*` kept, or a specifier of its own (a package's), which may name anything.
 */
export type Mapping = { key: string; targets: string[] };

/**
 * The project's mappings, or undefined when one of them cannot be known from its text: a Vite alias
 * by a pattern, which may match any specifier, or a tsconfig that does not read.
 */
export function projectMappings(
	resolution: Resolution,
	manifests: readonly string[],
): Mapping[] | undefined {
	const mappings: Mapping[] = [];
	for (const { find, replacement } of resolution.aliases) {
		if (typeof find !== "string") return undefined;
		// A string alias maps the specifier it is and every one below it, as Vite applies it.
		mappings.push({ key: find, targets: [replacement] });
		mappings.push({ key: `${find}/*`, targets: [`${replacement}/*`] });
	}
	if (resolution.tsconfig !== undefined) {
		const paths = tsconfigPaths(resolution.tsconfig);
		if (paths === undefined) return undefined;
		mappings.push(...paths);
	}
	for (const manifest of manifests) {
		const imports = packageImports(manifest);
		if (imports === undefined) return undefined;
		mappings.push(...imports);
	}
	return mappings;
}

/** A package.json's `imports`, each target from its directory; undefined when it does not read. */
function packageImports(manifest: string): Mapping[] | undefined {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(manifest, "utf8"));
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null || !("imports" in value)) {
		return [];
	}
	const { imports } = value;
	if (typeof imports !== "object" || imports === null) return [];
	return Object.entries(imports).map(([key, target]) => ({
		key,
		targets: targetsOf(target).map((each) =>
			each.startsWith(".") || isAbsolute(each)
				? resolve(dirname(manifest), each)
				: each,
		),
	}));
}

/** The paths an `imports` value may give: a string, or any of those in its array or conditions. */
function targetsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(targetsOf);
	if (typeof value === "object" && value !== null) {
		return Object.values(value).flatMap(targetsOf);
	}
	return [];
}
