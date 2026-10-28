import type { Catalog } from "./catalog.ts";
import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { lineCount } from "./declaration-maps.ts";
import { keyDeclaration } from "./declarations.ts";
import { GraiError, sortErrors } from "./error.ts";
import { fallbackPositions, messageSource } from "./fallbacks.ts";
import { InputConflict } from "./input-types.ts";
import { parseMessages } from "./key-messages.ts";
import type { LocaleMessage } from "./message.ts";

/** A key's declaration in the output's types, and the lines it takes, for the declaration maps. */
export type KeyDeclaration = { text: string; lines: number };

/** A key compiled and declared, as every key of an output written is. */
export type DeclaredKey = CompiledKey & { declared: KeyDeclaration };

const isDeclared = (key: CompiledKey): key is DeclaredKey =>
	key.declared !== undefined;

const everyKeyDeclared = (
	compilation: Compilation,
): compilation is Compilation<DeclaredKey> =>
	[...compilation.keys.values()].every(isDeclared);

/**
 * A key's declaration, from its messages, or the error naming the locale of an input no value suits
 * every use of. `sources` holds, for each locale, the catalog its message comes from.
 */
export function declarationOf(
	key: string,
	messages: readonly LocaleMessage[],
	base: Catalog | undefined,
	catalogs: readonly Catalog[],
	sources: readonly (Catalog | undefined)[],
): KeyDeclaration | GraiError {
	try {
		const text = keyDeclaration(key, messages, base?.messages.get(key));
		return { text, lines: lineCount(text) };
	} catch (error) {
		if (!(error instanceof InputConflict)) throw error;
		for (const [index, { file, locale }] of catalogs.entries()) {
			if (locale !== error.locale) continue;
			const where = { file: sources[index]?.file ?? file, key, locale };
			return new GraiError(error.code, where, error.message);
		}
		throw error;
	}
}

/**
 * A compilation with every key declared: a key its compile left undeclared (`compileCatalogs`
 * with `declare` false) is declared now, as a compile declares it, its messages parsed again. A key
 * that cannot be is left out, and its error added, which then stops the output from being written.
 */
export function declareKeys(
	config: Config,
	compilation: Compilation,
): Compilation<DeclaredKey> {
	if (everyKeyDeclared(compilation)) return compilation;
	const { catalogs } = compilation;
	const base = catalogs.find((catalog) => catalog.locale === config.baseLocale);
	const fallbackOf = fallbackPositions(config.locales, config.fallbacks);
	const errors: GraiError[] = [];
	const keys = new Map<string, DeclaredKey>();
	for (const [key, compiled] of compilation.keys) {
		if (isDeclared(compiled)) {
			keys.set(key, compiled);
			continue;
		}
		const sources = catalogs.map((_, index) =>
			messageSource(key, index, catalogs, fallbackOf),
		);
		const messages = parseMessages(
			key,
			catalogs,
			sources,
			compiled.values,
			errors,
		);
		if (messages === undefined) continue;
		const declared = declarationOf(key, messages, base, catalogs, sources);
		if (declared instanceof GraiError) errors.push(declared);
		else keys.set(key, { ...compiled, declared });
	}
	return {
		...compilation,
		keys,
		errors: sortErrors([...compilation.errors, ...errors]),
	};
}
