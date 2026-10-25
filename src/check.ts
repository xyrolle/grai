import { relative } from "node:path";
import type { Catalog } from "./catalog.ts";
import { compileCatalogs } from "./compilation.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import type { Config } from "./config.ts";
import { GraiError, sortErrors } from "./error.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { isSeed, untranslatedKeys } from "./seed.ts";
import {
	namesIn,
	sourceFiles,
	splitTests,
	type TestNames,
	testsNaming,
} from "./sources.ts";

/** What a check found: the problems, and each locale's keys that are still untranslated. */
export type Checked = {
	problems: GraiError[];
	untranslated: Map<string, string[]>;
};

/**
 * Every problem of a project, without writing anything: each error a compile would report, each
 * key no shipped source file names, each input one locale reads and another never does, and each
 * key `identicalToBase` lists that the catalogs no longer bear out. Source files are those under
 * the project's root, or under `sources` when given, outside the outdir, dependencies, build
 * output and dot-directories; those the config's `tests` match ship nothing. Beside them, the keys
 * each locale has not translated yet, which are not problems: a message can rightly read as the
 * base locale's.
 */
export async function check(
	configFile: string,
	sources?: readonly string[],
): Promise<Checked> {
	const read = await readProject(configFile);
	if ("errors" in read)
		return { problems: read.errors, untranslated: new Map() };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { problems: errors, untranslated: new Map() };
	const { config } = read;
	const compilation = compileCatalogs(config, catalogs);
	const roots = sources ?? [config.root];
	const files = sourceFiles(roots, config.root, config.outdir);
	const { shipped, tests } = splitTests(files, config.tests);
	const names = namesIn(shipped);
	const problems = [...compilation.errors];
	for (const key of compilation.keys.keys()) {
		if (!names.has(key)) {
			problems.push(unused(key, config, catalogs, roots, tests));
		}
		problems.push(...differingInputs(key, catalogs));
	}
	problems.push(...staleIdentical(config, configFile, catalogs));
	return {
		problems: sortErrors(problems),
		untranslated: untranslatedKeys(
			catalogs,
			config.baseLocale,
			config.identicalToBase,
		),
	};
}

function unused(
	key: string,
	config: Config,
	catalogs: readonly Catalog[],
	roots: readonly string[],
	tests: readonly TestNames[],
): GraiError {
	const base = catalogs.find((catalog) => catalog.locale === config.baseLocale);
	const where = roots.map((root) => shownFrom(config.root, root)).join(", ");
	const testing = testsNaming(tests, key);
	const detail =
		testing === undefined
			? `no source file under ${where} names the key. Remove it from every catalog, or use it.`
			: `no source file under ${where} names the key but tests, which ship nothing: ${testing}. Remove it from every catalog and from those tests, or use it.`;
	return new GraiError("key-unused", { file: base?.file ?? "", key }, detail);
}

/** A directory as the project names it: relative to its root, or in full when outside it. */
function shownFrom(root: string, directory: string): string {
	const path = relative(root, directory);
	return path === "" ? "." : path.startsWith("..") ? directory : path;
}

/** An error for each key `identicalToBase` lists that the catalogs no longer bear out. */
function staleIdentical(
	config: Config,
	configFile: string,
	catalogs: readonly Catalog[],
): GraiError[] {
	const file = relative(config.root, configFile);
	const problems: GraiError[] = [];
	for (const [locale, keys] of config.identicalToBase) {
		for (const key of keys) {
			const why = staleness(key, locale, config.baseLocale, catalogs);
			if (why === undefined) continue;
			problems.push(
				new GraiError(
					"identical-stale",
					{ file, key, locale },
					`"identicalToBase" lists the key, ${why}. Remove it from the list.`,
				),
			);
		}
	}
	return problems;
}

/** Why a listed key is not one the locale writes as the base locale does any more, if it is not. */
function staleness(
	key: string,
	locale: string,
	baseLocale: string,
	catalogs: readonly Catalog[],
): string | undefined {
	if (catalogs.every(({ messages }) => !messages.has(key))) {
		return "which no catalog has";
	}
	const messageIn = (of: string) =>
		catalogs.find((catalog) => catalog.locale === of)?.messages.get(key);
	const source = messageIn(baseLocale);
	const value = messageIn(locale);
	// A key only some catalogs have is the compile's error already.
	if (source === undefined || value === undefined) return undefined;
	return isSeed(value, source, locale)
		? undefined
		: `but its message is not ${baseLocale}'s any more`;
}

/** An error for each locale that never reads an input another locale reads. */
function differingInputs(
	key: string,
	catalogs: readonly Catalog[],
): GraiError[] {
	const inputs = new Map<Catalog, ReadonlySet<string>>();
	for (const catalog of catalogs) {
		try {
			inputs.set(
				catalog,
				parseMessage(catalog.locale, catalog.messages.get(key)).inputs,
			);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			return [];
		}
	}
	const all = new Set([...inputs.values()].flatMap((names) => [...names]));
	return [...inputs].flatMap(([catalog, names]) => {
		const missing = [...all].filter((name) => !names.has(name));
		if (missing.length === 0) return [];
		const readers = [...inputs]
			.filter(([, other]) => missing.some((name) => other.has(name)))
			.map(([other]) => other.locale);
		return [
			new GraiError(
				"inputs-differ",
				{ file: catalog.file, key, locale: catalog.locale },
				`the message never reads ${missing.map((name) => `{${name}}`).join(", ")}, which ${readers.join(", ")} read${readers.length === 1 ? "s" : ""}. Read it here too, or drop it everywhere.`,
			),
		];
	});
}
