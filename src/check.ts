import { relative } from "node:path";
import { type Catalog, fileOfKey } from "./catalog.ts";
import { type ProjectCode, readProjectCode } from "./code/project.ts";
import { readingOf } from "./code/reads.ts";
import { codeProblems } from "./code-problems.ts";
import { compileCatalogs } from "./compilation.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import type { Config } from "./config.ts";
import { descriptionProblems } from "./descriptions.ts";
import { GraiError, sortErrors } from "./error.ts";
import { keysImportProblems, keysImports } from "./key-path-imports.ts";
import { parseMessage } from "./message.ts";
import { compileOutputIfMissing } from "./output-present.ts";
import { MessageProblem } from "./problem.ts";
import { isSeed, untranslatedKeys } from "./seed.ts";
import { shownInputs } from "./shown-inputs.ts";
import { type TestNames, testsNaming } from "./sources.ts";

/** What a check found: the problems, and each locale's keys that are still untranslated. */
export type Checked = {
	problems: GraiError[];
	untranslated: Map<string, string[]>;
};

/**
 * Every problem of a project: each error a compile would report, each key no shipped code reads or
 * may reach, each place code names a key no catalog has, each file whose code does not parse, each
 * import of keys from keys.js where package.json gives each key its own path, each input one
 * locale shows and another never does, each key `identicalToBase` lists that the catalogs no
 * longer bear out, and each description of a key no catalog has. The code is read as
 * the bundler reads it (`code/`): the source files under the project's root, or under `sources`
 * when given, outside the outdir, dependencies, build output and dot-directories, with their
 * imports followed to the output, which is compiled first when it is missing, as its imports
 * resolve only then. Those the config's `tests` match ship nothing. Beside them, the keys each
 * locale has not translated yet, which are not problems: a message can rightly read as the base
 * locale's. The check after a fix takes the code the fix read as `code`, unless the fix wrote some.
 */
export async function check(
	configFile: string,
	sources?: readonly string[],
	code?: ProjectCode,
): Promise<Checked> {
	const read = await readProject(configFile);
	if ("errors" in read)
		return { problems: read.errors, untranslated: new Map() };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { problems: errors, untranslated: new Map() };
	const { config } = read;
	const compilation = compileCatalogs(config, catalogs);
	const roots = sources ?? [config.root];
	const keys = new Set(
		catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const compiled = await compileOutputIfMissing(configFile, config);
	if (compiled.length > 0) {
		return { problems: sortErrors(compiled), untranslated: new Map() };
	}
	const project = code ?? (await readProjectCode(config, roots));
	if (project instanceof GraiError) {
		return { problems: [project], untranslated: new Map() };
	}
	const reading = await readingOf(project);
	const {
		errors: codeErrors,
		reached,
		tests,
	} = codeProblems(reading, keys, config);
	const problems = [
		...compilation.errors,
		...codeErrors,
		...keysImportProblems(await keysImports(project, reading)),
	];
	for (const key of compilation.keys.keys()) {
		if (!reached(key)) {
			problems.push(unused(key, config, catalogs, roots, tests));
		}
		problems.push(...differingInputs(key, catalogs));
	}
	problems.push(...staleIdentical(config, configFile, catalogs));
	problems.push(
		...descriptionProblems(config, new Set(compilation.keys.keys())),
	);
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
			? `no shipped code under ${where} reads the key. Remove it from every catalog, or use it.`
			: `no shipped code under ${where} reads the key, only tests, which ship nothing: ${testing}. Remove it from every catalog and from those tests, or use it.`;
	const file = base === undefined ? "" : fileOfKey(base, key);
	return new GraiError("key-unused", { file, key }, detail);
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

/**
 * An error for each locale that never shows an input another locale shows: a placeholder a
 * translation lost, or one another invented. An input a locale only chooses by is its grammar.
 */
function differingInputs(
	key: string,
	catalogs: readonly Catalog[],
): GraiError[] {
	const inputs = new Map<Catalog, ReadonlySet<string>>();
	// A locale without the key takes its fallback's message, whose inputs are its fallback's.
	for (const catalog of catalogs.filter(({ messages }) => messages.has(key))) {
		try {
			inputs.set(
				catalog,
				shownInputs(parseMessage(catalog.locale, catalog.messages.get(key))),
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
				{ file: fileOfKey(catalog, key), key, locale: catalog.locale },
				`the message never shows ${missing.map((name) => `{${name}}`).join(", ")}, which ${readers.join(", ")} show${readers.length === 1 ? "s" : ""}. Show it here too, or drop it everywhere.`,
			),
		];
	});
}
