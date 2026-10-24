import type { Catalog } from "./catalog.ts";
import type { Config } from "./config.ts";
import { keyDeclaration } from "./declarations.ts";
import { sameJson } from "./edit.ts";
import { GraiError, sortErrors } from "./error.ts";
import { type LocaleMessage, parseMessage } from "./message.ts";
import { keyModule, type RuntimeFunction } from "./modules.ts";
import { MessageProblem } from "./problem.ts";

/** A key compiled from its raw messages, one per locale, kept so an unchanged key is not compiled again. */
export type CompiledKey = {
	values: readonly unknown[];
	code: string;
	declaration: string;
	uses: ReadonlySet<RuntimeFunction>;
	markup: boolean;
};

/** Every key compiled, or the errors that stop the output from being written. */
export type Compilation = {
	/** The catalogs compiled, one per locale. */
	catalogs: readonly Catalog[];
	keys: ReadonlyMap<string, CompiledKey>;
	/** The keys compiled again, added or removed since the previous compilation. */
	changed: ReadonlySet<string>;
	errors: readonly GraiError[];
};

const keyName = /^[A-Za-z_$][\w$]*$/;
/** Words a module cannot bind as an export's name. */
const reservedWords = new Set(
	"arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
		" ",
	),
);

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
	for (const key of candidates) {
		const reused = previous?.keys.get(key);
		if (
			reused !== undefined &&
			!collisions.has(key) &&
			unchanged(reused, catalogs, key)
		) {
			keys.set(key, reused);
			continue;
		}
		changed.add(key);
		keys.delete(key);
		const compiled = compileKey(key, catalogs, base, collisions, errors);
		if (compiled !== undefined) keys.set(key, compiled);
	}
	if (edited === undefined) {
		for (const key of previous?.keys.keys() ?? []) {
			if (!candidates.has(key)) changed.add(key);
		}
	}
	return { catalogs, keys, changed, errors: sortErrors(errors) };
}

/** Compiles one key, or adds why it cannot be to the errors. A key no catalog has any more is undefined. */
function compileKey(
	key: string,
	catalogs: readonly Catalog[],
	base: Catalog | undefined,
	collisions: ReadonlyMap<string, string>,
	errors: GraiError[],
): CompiledKey | undefined {
	const values = catalogs.map((catalog) => catalog.messages.get(key));
	if (values.every((value) => value === undefined)) return undefined;
	if (!isCompilable(key, values, collisions)) {
		errors.push(...keyProblems(key, catalogs, values, collisions));
		return undefined;
	}
	const messages = parseMessages(key, catalogs, values, errors);
	if (messages === undefined) return undefined;
	const module = keyModule(key, messages);
	return {
		values,
		code: module.code,
		declaration: keyDeclaration(key, messages, base?.messages.get(key)),
		uses: module.uses,
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

/** Whether each catalog still holds the raw message the key was compiled from. */
function unchanged(
	compiled: CompiledKey,
	catalogs: readonly Catalog[],
	key: string,
): boolean {
	return catalogs.every((catalog, index) => {
		const value = catalog.messages.get(key);
		const before = compiled.values[index];
		return value === before || sameJson(value, before);
	});
}

/** Each key that differs from another only in case, with that other key. */
function caseCollisions(keys: Iterable<string>): Map<string, string> {
	const seen = new Map<string, string>();
	const collisions = new Map<string, string>();
	for (const key of keys) {
		const folded = key.toLowerCase();
		const other = seen.get(folded);
		if (other === undefined) {
			seen.set(folded, key);
		} else {
			collisions.set(key, other);
			collisions.set(other, key);
		}
	}
	return collisions;
}

/** Whether a key can name a message: a JavaScript identifier that is not a reserved word. */
export function isKeyName(key: string): boolean {
	return keyName.test(key) && !reservedWords.has(key);
}

/** Whether a key can be compiled at all: a key name, colliding with no other, in every locale. */
function isCompilable(
	key: string,
	values: readonly unknown[],
	collisions: ReadonlyMap<string, string>,
): boolean {
	return isKeyName(key) && !collisions.has(key) && !values.includes(undefined);
}

/** Why a key cannot be compiled at all: it is no identifier, collides with another, or a locale lacks it. */
function keyProblems(
	key: string,
	catalogs: readonly Catalog[],
	values: readonly unknown[],
	collisions: ReadonlyMap<string, string>,
): GraiError[] {
	const file =
		catalogs.find((catalog) => catalog.messages.has(key))?.file ?? "";
	if (!isKeyName(key)) {
		return [
			new GraiError(
				"key-invalid",
				{ file, key },
				"a key must be a JavaScript identifier and not a reserved word, as it is the message's export name. Use letters, digits, _ and $.",
			),
		];
	}
	const collision = collisions.get(key);
	if (collision !== undefined) {
		return [
			new GraiError(
				"key-invalid",
				{ file, key },
				`the key differs from "${collision}" only in case, which a case-insensitive file system cannot tell apart. Rename one.`,
			),
		];
	}
	const present = catalogs.filter((_, index) => values[index] !== undefined);
	return catalogs
		.filter((_, index) => values[index] === undefined)
		.map(
			(catalog) =>
				new GraiError(
					"key-missing",
					{ file: catalog.file, key, locale: catalog.locale },
					`the key is in ${present.map((other) => other.locale).join(", ")} but not in ${catalog.locale}. Add it to every catalog, or remove it from all.`,
				),
		);
}

function parseMessages(
	key: string,
	catalogs: readonly Catalog[],
	values: readonly unknown[],
	errors: GraiError[],
): LocaleMessage[] | undefined {
	const messages: LocaleMessage[] = [];
	catalogs.forEach(({ file, locale }, index) => {
		try {
			messages.push(parseMessage(locale, values[index]));
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			errors.push(
				new GraiError(error.code, { file, key, locale }, error.message),
			);
		}
	});
	return messages.length === catalogs.length ? messages : undefined;
}
