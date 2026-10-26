import { resolve } from "node:path";
import type { Config } from "./config.ts";
import {
	namesIn,
	type SourceFile,
	sourceFiles,
	splitTests,
	type TestNames,
} from "./sources.ts";

/**
 * A project's source files as check reads them: every one, those that ship, the names each test
 * writes, and the names the shipped files write.
 */
export type ScannedSources = {
	readonly files: readonly SourceFile[];
	readonly shipped: readonly SourceFile[];
	readonly tests: readonly TestNames[];
	readonly names: ReadonlySet<string>;
};

/** The source files under the roots, split by the config's `tests`, with the names they write. */
export function scanSources(
	roots: readonly string[],
	config: Config,
): ScannedSources {
	const files = sourceFiles(roots, config.root, config.outdir);
	const { shipped, tests } = splitTests(files, config.tests);
	return { files, shipped, tests, names: namesIn(shipped) };
}

/** Whether a scan read one of the files at these paths, so that writing them leaves it stale. */
export function readAny(
	scanned: ScannedSources,
	paths: Iterable<string>,
): boolean {
	const read = new Set(scanned.files.map(({ path }) => resolve(path)));
	return [...paths].some((path) => read.has(resolve(path)));
}
