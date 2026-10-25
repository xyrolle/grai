import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { withoutKeys } from "./catalog-text.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import { withListedKeysChanged } from "./config-file.ts";
import { descriptionsWithout } from "./descriptions.ts";
import { type DynamicRead, dynamicReadsIn } from "./dynamic-reads.ts";
import { GraiError } from "./error.ts";
import { isKeyName } from "./key-checks.ts";
import { messageBindings, namespaceNames } from "./message-imports.ts";
import {
	namesIn,
	positionOf,
	type SourceFile,
	sourceFiles,
	splitTests,
	testsNaming,
} from "./sources.ts";
import { writeAll } from "./write-all.ts";

/** A read that kept unused keys: where it is, as `file:line:column`, what it reads, and the keys. */
export type KeptBy = { place: string; written: string; keys: string[] };

export type FixResult = {
	/** The keys removed from every catalog. */
	removed: string[];
	/** The removed keys that tests still name, with those tests, which need the same change. */
	inTests: Map<string, string>;
	/** The unused keys kept, because a read by a computed name may reach them. */
	kept: KeptBy[];
	/** The files written, relative to the project's root: catalogs, and the config if it listed one. */
	changed: string[];
	errors: GraiError[];
};

/**
 * Removes from every catalog, the config's lists and the descriptions file each key that no
 * shipped source file under the roots names, as `check` counts a key named, and that no read by a computed name
 * (`m[name]`, `m` used whole) in one may reach. The tests that still name a removed key are
 * reported, to change with it. A key that is no key name stays, since the scan finds only names
 * and so cannot tell whether a source writes it (`m["sign-in"]`); check reports it as invalid. It
 * writes every file or none, and none when a catalog would be left without messages.
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
	};
	const read = await readProject(configFile);
	if ("errors" in read) return { ...result, errors: read.errors };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { ...result, errors };
	const { config } = read;
	const { shipped, tests } = splitTests(
		sourceFiles(roots ?? [config.root], config.root, config.outdir),
		config.tests,
	);
	const names = namesIn(shipped);
	const namespaces = namespaceNames(shipped.map(({ text }) => text));
	const reads = shipped.flatMap((source) =>
		dynamicReadsIn(source.text, messageBindings(source.text, namespaces)).map(
			(read) => located(source, read),
		),
	);
	const keys = new Set(
		catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const unnamed = [...keys].filter((key) => isKeyName(key) && !names.has(key));
	for (const key of unnamed) {
		const reach = reads.find(({ prefix }) => key.startsWith(prefix));
		if (reach === undefined) result.removed.push(key);
		else reach.keys.push(key);
	}
	result.kept = reads
		.filter(({ keys }) => keys.length > 0)
		.map(({ place, written, keys }) => ({ place, written, keys }));
	const removed = new Set(result.removed);
	const emptied = catalogs.filter(({ messages }) =>
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

/** A dynamic read with its place and the keys it has kept so far. */
function located(
	source: SourceFile,
	read: DynamicRead,
): { place: string; written: string; prefix: string; keys: string[] } {
	const { line, column } = positionOf(source.text, read.at);
	return {
		place: `${source.file}:${line}:${column}`,
		written:
			read.written.length > longestShown
				? `${read.written.slice(0, longestShown - 1)}…`
				: read.written,
		prefix: read.prefix,
		keys: [],
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
