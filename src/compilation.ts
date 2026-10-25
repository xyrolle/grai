import type { Catalog } from "./catalog.ts";
import type { Config } from "./config.ts";
import { lineCount } from "./declaration-maps.ts";
import { keyDeclaration } from "./declarations.ts";
import { sameJson } from "./edit.ts";
import { GraiError, sortErrors } from "./error.ts";
import { fallbackPositions, messageSource } from "./fallbacks.ts";
import { caseCollisions, isCompilable, keyProblems } from "./key-checks.ts";
import { type LocaleMessage, parseMessage } from "./message.ts";
import { type KeyModule, keyModule, type RuntimeFunction } from "./modules.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A key compiled from its raw messages, one per locale, kept so an unchanged key is not compiled
 * again. Its kind, variants and parts are per locale, for an adapter that writes modules per locale.
 */
export type CompiledKey = Pick<
	KeyModule,
	"value" | "serverValue" | "kind" | "variants" | "parts"
> & {
	/** The key's name, which its module exports it under. */
	name: string;
	values: readonly unknown[];
	declaration: string;
	/** The lines the declaration takes, for the declaration maps. */
	declarationLines: number;
	uses: ReadonlySet<RuntimeFunction>;
	/** The functions of plurals.js the key's code calls, by name. */
	plurals: ReadonlySet<string>;
	/** The formatters the key's code calls, by name. */
	formats: KeyModule["formats"];
	/** The globals the key's code calls, such as `String`. */
	globals: KeyModule["globals"];
	markup: boolean;
};

/** Every key compiled, or the errors that stop the output from being written. */
export type Compilation = {
	/** The catalogs compiled, one per locale. */
	catalogs: readonly Catalog[];
	keys: ReadonlyMap<string, CompiledKey>;
	/** The keys compiled again, added or removed since the previous compilation. */
	changed: ReadonlySet<string>;
	/** The keys whose code calls a formatter, so formats.js is written from them alone. */
	formatted: ReadonlySet<string>;
	errors: readonly GraiError[];
};

/**
 * Compiles every key. A key whose raw messages equal the previous compilation's is taken from it
 * as it is. After an edit, only the keys the edit touched are looked at, so an edit costs only
 * the keys it changes.
 */
export function compileCatalogs(
	config: Config,
	catalogs: readonly Catalog[],
	previous?: Compilation,
): Compilation {
	const errors: GraiError[] = [];
	const edited =
		previous === undefined ? undefined : editedKeys(catalogs, previous);
	const keys = new Map(edited === undefined ? undefined : previous?.keys);
	const candidates = edited ?? allKeys(catalogs);
	const changed = new Set<string>();
	const adds = [...candidates].some(
		(key) =>
			previous?.keys.has(key) !== true &&
			catalogs.some((catalog) => catalog.messages.has(key)),
	);
	const collisions =
		previous !== undefined && !adds
			? new Map<string, string>()
			: caseCollisions(allKeys(catalogs));
	const base = catalogs.find((catalog) => catalog.locale === config.baseLocale);
	const fallbackOf = fallbackPositions(config.locales, config.fallbacks);
	for (const key of candidates) {
		const sources = catalogs.map((_, index) =>
			messageSource(key, index, catalogs, fallbackOf),
		);
		const reused = previous?.keys.get(key);
		if (
			reused !== undefined &&
			!collisions.has(key) &&
			unchanged(reused, sources, key)
		) {
			keys.set(key, reused);
			continue;
		}
		changed.add(key);
		keys.delete(key);
		const compiled = compileKey(
			key,
			catalogs,
			sources,
			base,
			collisions,
			errors,
		);
		if (compiled !== undefined) keys.set(key, compiled);
	}
	if (edited === undefined) {
		for (const key of previous?.keys.keys() ?? []) {
			if (!candidates.has(key)) changed.add(key);
		}
	}
	const formatted = new Set(
		edited === undefined ? undefined : previous?.formatted,
	);
	for (const key of edited === undefined ? keys.keys() : changed) {
		if ((keys.get(key)?.formats.size ?? 0) > 0) formatted.add(key);
		else formatted.delete(key);
	}
	return { catalogs, keys, changed, formatted, errors: sortErrors(errors) };
}

/**
 * Compiles one key, or adds why it cannot be to the errors. A key no catalog has any more is
 * undefined. `sources` holds, for each locale, the catalog its message comes from: its own, or the
 * one it falls back to.
 */
function compileKey(
	key: string,
	catalogs: readonly Catalog[],
	sources: readonly (Catalog | undefined)[],
	base: Catalog | undefined,
	collisions: ReadonlyMap<string, string>,
	errors: GraiError[],
): CompiledKey | undefined {
	const values = sources.map((source) => source?.messages.get(key));
	if (values.every((value) => value === undefined)) return undefined;
	if (!isCompilable(key, values, collisions)) {
		errors.push(...keyProblems(key, catalogs, values, collisions));
		return undefined;
	}
	const messages = parseMessages(key, catalogs, sources, values, errors);
	if (messages === undefined) return undefined;
	const module = keyModule(key, messages);
	const declaration = keyDeclaration(key, messages, base?.messages.get(key));
	return {
		name: key,
		values,
		value: module.value,
		serverValue: module.serverValue,
		declaration,
		declarationLines: lineCount(declaration),
		uses: module.uses,
		plurals: module.plurals,
		formats: module.formats,
		globals: module.globals,
		kind: module.kind,
		variants: module.variants,
		parts: module.parts,
		markup: messages.some((message) => message.markup),
	};
}

/**
 * The keys that can differ from the previous compilation's: those each edited catalog's edit
 * touched. Undefined when a catalog was parsed whole, so every key has to be looked at.
 */
function editedKeys(
	catalogs: readonly Catalog[],
	previous: Compilation,
): Set<string> | undefined {
	if (catalogs.length !== previous.catalogs.length) return undefined;
	const keys = new Set<string>();
	for (const [index, catalog] of catalogs.entries()) {
		const before = previous.catalogs[index];
		if (catalog === before) continue;
		if (catalog.edit === undefined || catalog.edit.from !== before)
			return undefined;
		for (const key of catalog.edit.keys) keys.add(key);
	}
	return keys;
}

function allKeys(catalogs: readonly Catalog[]): Set<string> {
	const keys = new Set<string>();
	for (const catalog of catalogs) {
		for (const key of catalog.messages.keys()) keys.add(key);
	}
	return keys;
}

/** Whether each locale's catalog, or its fallback's, still holds the raw message the key was compiled from. */
function unchanged(
	compiled: CompiledKey,
	sources: readonly (Catalog | undefined)[],
	key: string,
): boolean {
	return sources.every((source, index) => {
		const value = source?.messages.get(key);
		const before = compiled.values[index];
		return value === before || sameJson(value, before);
	});
}

/** Each locale's message parsed, its errors named by the file the message is in. */
function parseMessages(
	key: string,
	catalogs: readonly Catalog[],
	sources: readonly (Catalog | undefined)[],
	values: readonly unknown[],
	errors: GraiError[],
): LocaleMessage[] | undefined {
	const messages: LocaleMessage[] = [];
	catalogs.forEach(({ file, locale }, index) => {
		try {
			messages.push(parseMessage(locale, values[index]));
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			const where = { file: sources[index]?.file ?? file, key, locale };
			errors.push(new GraiError(error.code, where, error.message));
		}
	});
	return messages.length === catalogs.length ? messages : undefined;
}
