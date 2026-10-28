import { isRecord } from "./config.ts";
import type { Format } from "./format-options.ts";
import { type MarkupValue, markupVariables } from "./markup.ts";
import { parseMatch } from "./match.ts";
import {
	type FormattedLocal,
	type PluralLocal,
	parseDeclarations,
} from "./message-declarations.ts";
import { numberSelector } from "./number-select.ts";
import { identifier, isMarkup, type Part, parsePattern } from "./pattern.ts";
import { MessageProblem } from "./problem.ts";
import { type Selector, selectionOf, type Variant } from "./selection.ts";

/** One locale's message for a key, parsed and checked. */
export type LocaleMessage = {
	locale: string;
	/** Every input the message reads or declares. */
	inputs: ReadonlySet<string>;
	/** Plural locals by name, each with the input it counts and its type of rules. */
	plurals: ReadonlyMap<string, PluralLocal>;
	/** Formatted locals by name, each with the input it formats and how. */
	formatted: ReadonlyMap<string, FormattedLocal>;
	selectors: readonly Selector[];
	/** In the order a call tries them; a message without selectors has one variant with no keys. */
	variants: readonly Variant[];
	/** True when a value can match no variant, as a select lists its values without `*`. */
	closed: boolean;
	/** True when a variant has markup, so the message also has `.parts()`. */
	markup: boolean;
};

/** The names of a key's markup in every locale's message, sorted. */
export function markupNames(messages: readonly LocaleMessage[]): string[] {
	const names = new Set<string>();
	for (const { markup, variants } of messages) {
		if (!markup) continue;
		for (const { pattern } of variants) {
			for (const part of pattern) {
				if (isMarkup(part)) names.add(part.name);
			}
		}
	}
	return [...names].sort();
}

const messageFields = new Set(["declarations", "selectors", "match"]);

/**
 * Parses a catalog value: a pattern string, or the format's one-element array of
 * `declarations`, `selectors` and `match`.
 */
export function parseMessage(locale: string, value: unknown): LocaleMessage {
	if (typeof value === "string") return patternMessage(locale, value);
	const variants = Array.isArray(value) ? value[0] : undefined;
	if (!Array.isArray(value) || value.length !== 1 || !isRecord(variants)) {
		throw new MessageProblem(
			"message-invalid",
			"a message is a string, or an array of one object with declarations, selectors and match.",
		);
	}
	return parseVariants(locale, variants);
}

const noInputs: ReadonlySet<string> = new Set();
const noPlurals: ReadonlyMap<string, PluralLocal> = new Map();
const noFormatted: ReadonlyMap<string, FormattedLocal> = new Map();

/**
 * A message that is one pattern: its inputs are its placeholders, the inputs that give their
 * formatters an option, and its markup's variables.
 */
function patternMessage(locale: string, source: string): LocaleMessage {
	const pattern = parsePattern(source);
	// Made at the first input, as most patterns are text alone and share `noInputs`.
	let inputs: Set<string> | undefined;
	const add = (name: string) => {
		inputs ??= new Set();
		inputs.add(name);
	};
	let markup = false;
	for (const part of pattern) {
		if (part.type === "variable" || part.type === "literal") {
			if (part.type === "variable") add(part.name);
			const given = part.format?.input?.name;
			if (given) add(given);
		} else if (isMarkup(part)) {
			markup = true;
			for (const name of markupVariables(part)) add(name);
		}
	}
	return {
		locale,
		inputs: inputs ?? noInputs,
		plurals: noPlurals,
		formatted: noFormatted,
		selectors: [],
		variants: [{ keys: [], pattern }],
		closed: false,
		markup,
	};
}

function parseVariants(
	locale: string,
	value: Record<string, unknown>,
): LocaleMessage {
	for (const field of Object.keys(value)) {
		if (!messageFields.has(field)) {
			throw new MessageProblem(
				"message-invalid",
				`"${field}" is not part of a message; its parts are declarations, selectors and match.`,
			);
		}
	}
	const { declared, plurals, formatted, strings } = parseDeclarations(
		stringList(value.declarations ?? [], "declarations"),
	);
	const selectors = selectorNames(value.selectors ?? []).map(
		(name): Selector => {
			const number = formatted.get(name);
			if (number !== undefined) return numberSelector(name, number);
			const local = plurals.get(name);
			if (local !== undefined) return { kind: "plural", name, ...local };
			const text = strings.get(name);
			return text === undefined
				? { kind: "input", name, input: name, normalized: false }
				: { kind: "input", name, input: text, normalized: true };
		},
	);
	const variants = shownAsInputs(parseMatch(value.match, selectors), strings);
	return withInputs(locale, {
		declared,
		plurals,
		formatted,
		strings,
		selectors,
		variants,
	});
}

/** The message with every input it reads: declared ones, placeholders, and the inputs plurals count. */
function withInputs(
	locale: string,
	{
		declared,
		plurals,
		formatted,
		strings,
		selectors,
		variants,
	}: {
		declared: readonly string[];
		plurals: ReadonlyMap<string, PluralLocal>;
		formatted: ReadonlyMap<string, FormattedLocal>;
		strings: ReadonlyMap<string, string>;
		selectors: readonly Selector[];
		variants: readonly Variant[];
	},
): LocaleMessage {
	const inputs = new Set(declared);
	for (const local of plurals.values()) inputs.add(local.input);
	const isLocal = (name: string) =>
		plurals.has(name) || formatted.has(name) || strings.has(name);
	const madeFrom = new Map<string, string>([
		...[...plurals, ...formatted].map(([name, { input }]): [string, string] => [
			name,
			input,
		]),
		...strings,
	]);
	for (const [name, input] of madeFrom) {
		if (isLocal(input)) {
			throw new MessageProblem(
				"unsupported",
				`${name} is made from ${input}, a local, which grai does not support yet. Make it from the input ${input} is made from.`,
			);
		}
	}
	for (const input of strings.values()) inputs.add(input);
	const addOptionInput = (format: Format | undefined) => {
		const name = format?.input?.name;
		if (name === undefined) return;
		if (isLocal(name)) {
			throw new MessageProblem(
				"message-invalid",
				`an option takes ${name}, a local. An option takes an input: name the input itself.`,
			);
		}
		inputs.add(name);
	};
	for (const local of formatted.values()) {
		inputs.add(local.input);
		addOptionInput(local.format);
	}
	for (const selector of selectors) {
		if (selector.kind === "input") inputs.add(selector.input);
	}
	let markup = false;
	for (const { pattern } of variants) {
		for (const part of pattern) {
			if (part.type === "variable") {
				if (part.format !== undefined && isLocal(part.name)) {
					throw new MessageProblem(
						"unsupported",
						`it formats ${part.name}, a local, which grai does not support. Format the input it is made from.`,
					);
				}
				if (!isLocal(part.name)) inputs.add(part.name);
				addOptionInput(part.format);
			} else if (part.type === "literal") {
				addOptionInput(part.format);
			} else if (isMarkup(part)) {
				markup = true;
				for (const name of markupVariables(part)) {
					if (!isLocal(name)) inputs.add(name);
				}
			}
		}
	}
	for (const name of plurals.keys()) {
		if (inputs.has(name)) {
			throw new MessageProblem(
				"message-invalid",
				`"${name}" is declared both as an input and as a plural local. Rename the local, such as ${name}Plural.`,
			);
		}
	}
	for (const name of formatted.keys()) {
		if (inputs.has(name) || plurals.has(name)) {
			throw new MessageProblem(
				"message-invalid",
				`"${name}" is declared both as a formatted local and as an input or a plural local. Rename the local, such as ${name}Text.`,
			);
		}
	}
	const { variants: ordered, closed } = selectionOf(
		locale,
		selectors,
		variants,
	);
	return {
		locale,
		inputs,
		plurals,
		formatted,
		selectors,
		variants: ordered,
		closed,
		markup,
	};
}

/**
 * The variants with each `:string` local they show, as text or as a markup option, shown as the
 * input it is the text of, which is the value MessageFormat 2 gives it.
 */
function shownAsInputs(
	variants: Variant[],
	strings: ReadonlyMap<string, string>,
): Variant[] {
	if (strings.size === 0) return variants;
	const shown = (name: string) => strings.get(name) ?? name;
	return variants.map(({ keys, pattern }) => ({
		keys,
		pattern: pattern.map((part): Part => {
			if (part.type === "variable") {
				return part.format === undefined
					? { ...part, name: shown(part.name) }
					: part;
			}
			if (!isMarkup(part)) return part;
			const options = [...part.options].map(
				([option, value]): [string, MarkupValue] => [
					option,
					"variable" in value ? { variable: shown(value.variable) } : value,
				],
			);
			return { ...part, options: new Map(options) };
		}),
	}));
}

/** The names `selectors` lists, each a name and each once: a second selector on a value adds nothing. */
function selectorNames(value: unknown): string[] {
	const names = stringList(value, "selectors");
	for (const [index, name] of names.entries()) {
		if (!identifier.test(name)) {
			throw new MessageProblem(
				"message-invalid",
				`"${name}" is not a selector: a selector is the name of an input or a local, such as count.`,
			);
		}
		if (names.indexOf(name) !== index) {
			throw new MessageProblem(
				"message-invalid",
				`"selectors" lists ${name} twice, and a second selector on a value chooses nothing the first does not. List it once.`,
			);
		}
	}
	return names;
}

function stringList(value: unknown, field: string): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((item): item is string => typeof item === "string")
	) {
		throw new MessageProblem(
			"message-invalid",
			`"${field}" must be a list of strings.`,
		);
	}
	return value;
}
