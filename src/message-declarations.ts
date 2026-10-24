/**
 * A message's declarations, as the inlang format writes them: `input x`, `local y = x: plural` and
 * `local y = x: number …`.
 */

import { type Format, parseFormat } from "./format-options.ts";
import { MessageProblem } from "./problem.ts";

/** A local such as `local price = amount: number style=currency currency=EUR`. */
export type FormattedLocal = { input: string; format: Format };

/** A message's declarations: its inputs, and its plural and formatted locals by name. */
export type Declarations = {
	declared: readonly string[];
	plurals: ReadonlyMap<string, string>;
	formatted: ReadonlyMap<string, FormattedLocal>;
};

const inputDeclaration = /^input\s+([A-Za-z_$][\w$]*)$/;
const pluralDeclaration =
	/^local\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*:\s*plural$/;
const functionDeclaration =
	/^local\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*:\s*(\S+)(.*)$/;

export function parseDeclarations(texts: readonly string[]): Declarations {
	const declared: string[] = [];
	const plurals = new Map<string, string>();
	const formatted = new Map<string, FormattedLocal>();
	for (const text of texts) {
		const declaration = parseDeclaration(text);
		if (declaration.kind === "input") declared.push(declaration.name);
		else if (declaration.kind === "plural") {
			plurals.set(declaration.name, declaration.input);
		} else formatted.set(declaration.name, declaration);
	}
	return { declared, plurals, formatted };
}

/** A declaration: an input, a plural local of an input, or a formatted local of one. */
type Declaration =
	| { kind: "input"; name: string }
	| { kind: "plural"; name: string; input: string }
	| ({ kind: "format"; name: string } & FormattedLocal);

function parseDeclaration(declaration: string): Declaration {
	const text = declaration.trim();
	const input = inputDeclaration.exec(text);
	if (input?.[1] !== undefined) return { kind: "input", name: input[1] };
	const plural = pluralDeclaration.exec(text);
	if (plural?.[1] !== undefined && plural[2] !== undefined) {
		return { kind: "plural", name: plural[1], input: plural[2] };
	}
	const [, name, operand, fn, options = ""] =
		functionDeclaration.exec(text) ?? [];
	if (name !== undefined && operand !== undefined && fn !== undefined) {
		if (fn === "plural") {
			throw new MessageProblem(
				"unsupported",
				`"${declaration}" passes options to plural, which grai does not support yet.`,
			);
		}
		const format = parseFormat(fn, options, `"${declaration}"`);
		return { kind: "format", name, input: operand, format };
	}
	throw new MessageProblem(
		"message-invalid",
		`"${declaration}" is not a declaration. Write "input name", "local namePlural = name: plural" or "local nameText = name: number".`,
	);
}
