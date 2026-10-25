/**
 * A message's declarations, as the inlang format writes them: `input x`, `local y = x: plural`,
 * `local y = x: plural type=ordinal` and `local y = x: number …`.
 */

import { type Call, parseCall } from "./format-options.ts";
import type { PluralType } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/** A local such as `local countPlural = count: plural`: the input it counts, by CLDR's rules of a type. */
export type PluralLocal = { input: string; type: PluralType };

/** A local such as `local price = amount: number style=currency currency=EUR`: its input, and the call. */
export type FormattedLocal = { input: string } & Call;

/** A message's declarations: its inputs, and its plural and formatted locals by name. */
export type Declarations = {
	declared: readonly string[];
	plurals: ReadonlyMap<string, PluralLocal>;
	formatted: ReadonlyMap<string, FormattedLocal>;
};

const inputDeclaration = /^input\s+([A-Za-z_$][\w$]*)$/;
const functionDeclaration =
	/^local\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*:\s*(\S+)(.*)$/;

/** A message's declarations; a name declared twice is an error, as in MessageFormat 2. */
export function parseDeclarations(texts: readonly string[]): Declarations {
	const declared: string[] = [];
	const plurals = new Map<string, PluralLocal>();
	const formatted = new Map<string, FormattedLocal>();
	const declarers = new Map<string, string>();
	for (const text of texts) {
		const declaration = parseDeclaration(text);
		const first = declarers.get(declaration.name);
		if (first !== undefined) {
			throw new MessageProblem(
				"message-invalid",
				`${declaration.name} is declared twice, by "${first}" and "${text}". Declare it once.`,
			);
		}
		declarers.set(declaration.name, text);
		if (declaration.kind === "input") declared.push(declaration.name);
		else if (declaration.kind === "plural")
			plurals.set(declaration.name, declaration);
		else formatted.set(declaration.name, declaration);
	}
	return { declared, plurals, formatted };
}

/** The name a declaration, such as `local price = amount: number`, gives its value. */
export function declaredName(declaration: string): string {
	return parseDeclaration(declaration).name;
}

/** A declaration: an input, a plural local of an input, or a formatted local of one. */
type Declaration =
	| { kind: "input"; name: string }
	| ({ kind: "plural"; name: string } & PluralLocal)
	| ({ kind: "format"; name: string } & FormattedLocal);

function parseDeclaration(declaration: string): Declaration {
	const text = declaration.trim();
	const input = inputDeclaration.exec(text);
	if (input?.[1] !== undefined) return { kind: "input", name: input[1] };
	const [, name, operand, fn, options = ""] =
		functionDeclaration.exec(text) ?? [];
	if (name !== undefined && operand !== undefined && fn !== undefined) {
		if (fn === "plural") {
			const type = pluralTypeOf(options.trim(), declaration);
			return { kind: "plural", name, input: operand, type };
		}
		const call = parseCall(fn, options, `"${declaration}"`);
		return { kind: "format", name, input: operand, ...call };
	}
	throw new MessageProblem(
		"message-invalid",
		`"${declaration}" is not a declaration. Write "input name", "local namePlural = name: plural" or "local nameText = name: number".`,
	);
}

/** The type of plural rules a plural local's options ask for: cardinal, unless `type=ordinal`. */
function pluralTypeOf(options: string, declaration: string): PluralType {
	if (options === "" || options === "type=cardinal") return "cardinal";
	if (options === "type=ordinal") return "ordinal";
	throw new MessageProblem(
		"message-invalid",
		`"${declaration}": plural takes one option, type, which is cardinal (the default) or ordinal, as in "local nOrdinal = n: plural type=ordinal".`,
	);
}
