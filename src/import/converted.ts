import type { PluralType } from "../plurals.ts";
import { MessageProblem } from "../problem.ts";
import { catchAll } from "../selection.ts";

/** One way a converted message reads: the value each selector needs for it, and its pattern. */
export type Branch = {
	/** Selector name to key; a selector it does not name takes any value. */
	keys: ReadonlyMap<string, string>;
	/** In grai's pattern syntax, escapes included. */
	pattern: string;
};

/** A message converted from another library's format, before it is written to a catalog. */
export type Converted = {
	declarations: readonly string[];
	/** In the order MessageFormat 2 weighs them: the outermost choice first. */
	selectors: readonly string[];
	branches: readonly Branch[];
};

/** A source message: where it sits in the nested JSON, and its value there. */
export type SourceEntry = { path: readonly string[]; value: unknown };

/** One message of the import, converted or with the reason it could not be. */
export type ImportedMessage = {
	/** The path of the message in its source; a plural's ends in its key without the suffix. */
	path: readonly string[];
	result: Converted | MessageProblem;
	/** What renders differently in grai than in the source library. */
	notes: string[];
};

/** A catalog value in grai's format: a pattern, or one object of declarations, selectors and match. */
export type CatalogValue =
	| string
	| [
			{
				declarations: string[];
				selectors: string[];
				match: Record<string, string>;
			},
	  ];

/** A branch that needs no selector value. */
export function plain(pattern: string): Branch {
	return { keys: new Map(), pattern };
}

/** Each branch of `a` followed by each of `b`, with the selector values both need. */
export function combine(a: readonly Branch[], b: readonly Branch[]): Branch[] {
	return a.flatMap((first) =>
		b.map((second) => ({
			keys: new Map([...first.keys, ...second.keys]),
			pattern: first.pattern + second.pattern,
		})),
	);
}

/** The branch, needing the selector values `keys` too. */
export function withKeys(
	branch: Branch,
	keys: readonly [string, string][],
): Branch {
	return { keys: new Map([...branch.keys, ...keys]), pattern: branch.pattern };
}

/** A message of one pattern, without selectors. */
export function plainMessage(pattern: string): Converted {
	return {
		declarations: [],
		selectors: [],
		branches: [plain(pattern)],
	};
}

/** The catalog value of a converted message, each branch a `match` entry with `*` for the selectors it leaves open. */
export function catalogValue(message: Converted): CatalogValue {
	const [only] = message.branches;
	if (message.selectors.length === 0 && only !== undefined) return only.pattern;
	const match: Record<string, string> = {};
	for (const { keys, pattern } of message.branches) {
		const key = message.selectors
			.map((selector) => `${selector}=${keys.get(selector) ?? catchAll}`)
			.join(",");
		if (key in match) {
			throw new MessageProblem(
				"message-invalid",
				`two of its variants both need ${key}, so one of them could never be chosen.`,
			);
		}
		match[key] = pattern;
	}
	return [
		{
			declarations: [...message.declarations],
			selectors: [...message.selectors],
			match,
		},
	];
}

/** A source value as a message's text: the libraries imported hold every message as a string. */
export function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	throw new MessageProblem(
		"unsupported",
		`its value is ${Array.isArray(value) ? "a list" : `a ${typeof value}`}, not a string; grai messages are text.`,
	);
}

/** Text as grai's pattern syntax reads it back: `\`, `{` and `}` escaped. */
export function escapeText(text: string): string {
	return text.replace(/[\\{}]/g, (char) => `\\${char}`);
}

/** The selector values a plural option needs: an exact value of the input, a category of its local, or none for other. */
export function pluralOptionKeys(
	input: string,
	local: string,
	option: string,
): [string, string][] {
	if (option.startsWith("=")) return [[input, option.slice(1)]];
	return option === "other" ? [] : [[local, option]];
}

/**
 * The declaration of a plural local that counts an input, such as `local countPlural = count:
 * plural`, by a name the message's inputs do not take: countPlural, or countOrdinal for ordinals.
 */
export function pluralLocal(
	input: string,
	type: PluralType,
	taken: ReadonlySet<string>,
): { name: string; declaration: string } {
	const base = `${input}${type === "cardinal" ? "Plural" : "Ordinal"}`;
	let name = base;
	for (let suffix = 2; taken.has(name); suffix++) name = `${base}${suffix}`;
	const options = type === "cardinal" ? "" : " type=ordinal";
	return { name, declaration: `local ${name} = ${input}: plural${options}` };
}
