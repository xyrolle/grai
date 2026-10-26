import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { withoutKeys } from "./catalog-text.ts";
import { type ProjectCode, readProjectCode } from "./code/project.ts";
import { type Reach, readingOf } from "./code/reads.ts";
import { codeProblems, mayReach, unknownReads } from "./code-problems.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import { withListedKeysChanged } from "./config-file.ts";
import { descriptionsWithout } from "./descriptions.ts";
import { GraiError } from "./error.ts";
import { compileOutputIfMissing } from "./output-present.ts";
import { positionOf, testsNaming } from "./sources.ts";
import { writeAll } from "./write-all.ts";

/** A read that kept unused keys: where it is, as `file:line:column`, what it reads, and the keys. */
export type KeptBy = { place: string; written: string; keys: string[] };

export type FixResult = {
	/** The keys removed from every catalog. */
	removed: string[];
	/** The removed keys that tests still read, with those tests, which need the same change. */
	inTests: Map<string, string>;
	/** The unused keys kept, because a read that may reach more keys than one may reach them. */
	kept: KeptBy[];
	/** The files written, relative to the project's root: catalogs, and the config if it listed one. */
	changed: string[];
	errors: GraiError[];
	/**
	 * The code it read, for the check after it to take, as it writes only JSON objects, which no
	 * source that parses holds; none when it stopped before reading it.
	 */
	code: ProjectCode | undefined;
};

/**
 * Removes from every catalog, the config's lists and the descriptions file each key that no
 * shipped code under the roots reads, and that no read that may reach more keys than one (a
 * computed read, `m` used whole, a load by a pattern) may reach, the code read as `check` reads it.
 * The tests that still read a removed key are reported, to change with it. A file whose code does
 * not parse leaves its reads unknown, so nothing is removed and the error says where. It writes
 * every file or none, and none when a catalog would be left without messages, unless its locale
 * falls back on another for the words it lacks.
 */
export async function removeUnusedKeys(
	configFile: string,
	roots?: readonly string[],
): Promise<FixResult> {
	const result: FixResult = {
		removed: [],
		inTests: new Map(),
		kept: [],
		changed: [],
		errors: [],
		code: undefined,
	};
	const read = await readProject(configFile);
	if ("errors" in read) return { ...result, errors: read.errors };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { ...result, errors };
	const { config } = read;
	const compiled = await compileOutputIfMissing(configFile, config);
	if (compiled.length > 0) return { ...result, errors: [...compiled] };
	const code = await readProjectCode(config, roots ?? [config.root]);
	if (code instanceof GraiError) return { ...result, errors: [code] };
	const reading = await readingOf(code);
	const keys = new Set(
		catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const problems = codeProblems(reading, keys, config);
	const unknown = unknownReads(problems);
	if (unknown.length > 0) return { ...result, errors: unknown };
	result.code = code;
	const { shipped, tests } = problems;
	const named = new Set(shipped.reads.map(({ key }) => key));
	const reaches = shipped.reaches.map(
		(reach): { reach: Reach; keys: string[] } => ({ reach, keys: [] }),
	);
	for (const key of keys) {
		if (named.has(key)) continue;
		const keeping = reaches.find(({ reach }) => mayReach(reach, key));
		if (keeping === undefined) result.removed.push(key);
		else keeping.keys.push(key);
	}
	result.kept = reaches
		.filter(({ keys }) => keys.length > 0)
		.map(({ reach, keys }) => ({ ...shown(reach), keys }));
	const removed = new Set(result.removed);
	// A locale that falls back takes the words it lacks from another, so its catalog may be empty.
	const emptied = catalogs.filter(
		({ locale, messages }) =>
			!config.fallbacks.has(locale) &&
			[...messages.keys()].every((key) => removed.has(key)),
	);
	if (emptied.length > 0) {
		return {
			...result,
			removed: [],
			errors: emptied.map(
				({ file, locale }) =>
					new GraiError(
						"catalog-empty",
						{ file, locale },
						"every key of the catalog is unused, and removing them all would leave it without messages. Use one, or remove the locale.",
					),
			),
		};
	}
	if (removed.size === 0) return result;
	for (const key of removed) {
		const testing = testsNaming(tests, key);
		if (testing !== undefined) result.inTests.set(key, testing);
	}
	const texts = new Map<string, string>();
	for (const { file, bytes } of read.sources) {
		const text = bytes.toString("utf8");
		texts.set(join(config.root, file), withoutKeys(text, removed));
	}
	const configText = withListedKeysChanged(
		readFileSync(configFile, "utf8"),
		config.identicalToBase,
		(key) => (removed.has(key) ? undefined : key),
	);
	if (configText !== undefined) texts.set(resolve(configFile), configText);
	const described = descriptionsWithout(config, removed);
	if (described !== undefined) texts.set(described.file, described.text);
	writeAll(texts);
	const changed = [...texts.keys()].map((path) => relative(config.root, path));
	return { ...result, changed };
}

/** How much of a read the report shows. */
const longestShown = 80;

/** A read that keeps keys, as the report shows it: its place, and what it writes, cut short. */
function shown({ source, at, written }: Reach): {
	place: string;
	written: string;
} {
	const { line, column } = positionOf(source.text, at.start);
	return {
		place: `${source.file}:${line}:${column}`,
		written:
			written.length > longestShown
				? `${written.slice(0, longestShown - 1)}…`
				: written,
	};
}

/** What check --fix prints before the check: each key removed, and each read that kept keys. */
export function fixLines({ removed, inTests, kept }: FixResult): string[] {
	const testing = (key: string) => {
		const tests = inTests.get(key);
		return tests === undefined ? "" : `; tests still name it: ${tests}`;
	};
	return [
		...removed.map(
			(key) => `removed: "${key}" from every catalog${testing(key)}`,
		),
		...kept.map(
			({ place, written, keys }) =>
				`kept: ${place}: ${written} may name ${keys.length === 1 ? `"${keys[0]}", so it stays` : `${keys.length} unused keys, so they stay`}`,
		),
	];
}
