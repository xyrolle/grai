/**
 * Where an import of grai's output resolves while the output is not written yet, as on a fresh
 * clone's first `next dev` start, whose read of the app's code runs beside the compile that writes
 * it (`next/first-groups.ts`). The resolver finds no file then, so an import it leaves unresolved is
 * taken by its own path when relative, or through the project's mappings (`mappings.ts`), to where
 * the output's modules go. One that lands on none of them names nothing, as the resolver said.
 */

import { dirname, isAbsolute, resolve } from "node:path";
import { pathNames } from "./candidates.ts";
import type { Mapping } from "./mappings.ts";
import type { Output } from "./modules.ts";

/** No folder's package.json names the output as its entry: the app imports its modules by path. */
const entries: ReadonlySet<string> = new Set();

export function unwrittenOutput(
	output: Output,
	mappings: readonly Mapping[],
): (source: string, importer: string) => string | undefined {
	const modules = [output.keys, output.messages];
	const landed = (path: string) =>
		modules.find((module) => pathNames(path, module, entries));
	return (source, importer) => {
		if (source.startsWith(".") || isAbsolute(source)) {
			return landed(resolve(dirname(importer), source));
		}
		for (const { key, targets } of mappings) {
			const taken = starText(key, source);
			if (taken === undefined) continue;
			for (const target of targets) {
				if (!isAbsolute(target)) continue;
				const module = landed(target.replace("*", taken));
				if (module !== undefined) return module;
			}
		}
		return undefined;
	};
}

/**
 * What a mapping's `*` takes of a specifier it matches, the empty text for a key without one, or
 * undefined when it does not match.
 */
function starText(key: string, source: string): string | undefined {
	const star = key.indexOf("*");
	if (star === -1) return source === key ? "" : undefined;
	const before = key.slice(0, star);
	const after = key.slice(star + 1);
	return source.length >= before.length + after.length &&
		source.startsWith(before) &&
		source.endsWith(after)
		? source.slice(before.length, source.length - after.length)
		: undefined;
}
