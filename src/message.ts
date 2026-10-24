import { isRecord } from "./config.ts";
import { type Format, parseFormat } from "./formats.ts";
import { parsePattern } from "./pattern.ts";
import { MessageProblem } from "./problem.ts";
import { type Selector, selectionOf, type Variant } from "./selection.ts";

/** One locale's message for a key, parsed and checked. */
export type LocaleMessage = {
	locale: string;
	/** Every input the message reads or declares. */
	inputs: ReadonlySet<string>;
	/** Plural locals by name, each with the input it counts. */
	plurals: ReadonlyMap<string, string>;
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

/** A local such as `local price = amount: number style=currency currency=EUR`. */
export type FormattedLocal = { input: string; format: Format };

const messageFields = new Set(["declarations", "selectors", "match"]);
const inputDeclaration = /^input\s+([A-Za-z_$][\w$]*)$/;
const pluralDeclaration =
	/^local\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*:\s*plural$/;
const functionDeclaration =
	/^local\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*:\s*(\S+)(.*)$/;

/**
 * Parses a catalog value: a pattern string, or the format's one-element array of
 * `declarations`, `selectors` and `match`.
 */
export function parseMessage(locale: string, value: unknown): LocaleMessage {
	if (typeof value === "string") return patternMessage(locale, value);
	if (isRecord(value)) {
		throw new MessageProblem(
			"unsupported",
			"the value is an object of nested keys, which grai does not support. Flatten it into keys joined by _.",
		);
	}
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
const noPlurals: ReadonlyMap<string, string> = new Map();
const noFormatted: ReadonlyMap<string, FormattedLocal> = new Map();

/** A message that is one pattern: its inputs are its placeholders. */
function patternMessage(locale: string, source: string): LocaleMessage {
	const pattern = parsePattern(source);
	let inputs = noInputs;
	let markup = false;
	for (const part of pattern) {
		if (part.type === "variable") inputs = new Set([...inputs, part.name]);
		else if (part.type !== "text") markup = true;
	}
	return {
		locale,
		inputs,
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
	const declared: string[] = [];
	const plurals = new Map<string, string>();
	const formatted = new Map<string, FormattedLocal>();
	for (const text of stringList(value.declarations ?? [], "declarations")) {
		const declaration = parseDeclaration(text);
		if (declaration.kind === "input") declared.push(declaration.name);
		else if (declaration.kind === "plural") {
			plurals.set(declaration.name, declaration.input);
		} else formatted.set(declaration.name, declaration);
	}
	const selectors = stringList(value.selectors ?? [], "selectors").map(
		(name): Selector => {
			if (formatted.has(name)) {
				throw new MessageProblem(
					"unsupported",
					`it selects on ${name}, a formatted value, which grai does not support. Select on the input, or on a plural local of it.`,
				);
			}
			const input = plurals.get(name);
			return input === undefined
				? { kind: "input", name }
				: { kind: "plural", name, input };
		},
	);
	const variants = parseMatch(value.match, selectors);
	return withInputs(locale, {
		declared,
		plurals,
		formatted,
		selectors,
		variants,
	});
}

/** The variants of `match`, each key split by selector; two variants with the same keys are an error. */
function parseMatch(match: unknown, selectors: readonly Selector[]): Variant[] {
	if (!isRecord(match) || Object.keys(match).length === 0) {
		throw new MessageProblem(
			"message-invalid",
			'"match" must be an object of patterns by variant key, such as { "countPlural=one": "…" }.',
		);
	}
	const variants: Variant[] = [];
	const written = new Set<string>();
	for (const [key, pattern] of Object.entries(match)) {
		if (typeof pattern !== "string") {
			throw new MessageProblem(
				"message-invalid",
				`the variant "${key}" must be a pattern string.`,
			);
		}
		const keys = parseVariantKey(key, selectors);
		if (written.has(keys.join(","))) {
			throw new MessageProblem(
				"message-invalid",
				`two variants have the keys ${keys.join(",")}, so one of them can never be chosen. Remove one.`,
			);
		}
		written.add(keys.join(","));
		variants.push({ keys, pattern: parsePattern(pattern) });
	}
	return variants;
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

/** Splits a variant key such as `a=one,b=*` into one key per selector, in selector order. */
function parseVariantKey(
	key: string,
	selectors: readonly Selector[],
): string[] {
	const keys = new Map<string, string>();
	for (const part of key === "" ? [] : key.split(",")) {
		const [name = "", value = "", extra] = part
			.split("=")
			.map((side) => side.trim());
		if (name === "" || value === "" || extra !== undefined) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" must be selector=value pairs joined by commas, such as "countPlural=one".`,
			);
		}
		if (
			!selectors.some((selector) => selector.name === name) ||
			keys.has(name)
		) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" names "${name}", which is not a selector or is named twice; the selectors are ${listOf(selectors)}.`,
			);
		}
		keys.set(name, value);
	}
	return selectors.map((selector) => {
		const value = keys.get(selector.name);
		if (value === undefined) {
			throw new MessageProblem(
				"message-invalid",
				`the variant key "${key}" has no value for the selector "${selector.name}". Give it one, or * for any.`,
			);
		}
		return value;
	});
}

/** The message with every input it reads: declared ones, placeholders, and the inputs plurals count. */
function withInputs(
	locale: string,
	{
		declared,
		plurals,
		formatted,
		selectors,
		variants,
	}: {
		declared: readonly string[];
		plurals: ReadonlyMap<string, string>;
		formatted: ReadonlyMap<string, FormattedLocal>;
		selectors: readonly Selector[];
		variants: readonly Variant[];
	},
): LocaleMessage {
	const inputs = new Set(declared);
	for (const counted of plurals.values()) inputs.add(counted);
	for (const local of formatted.values()) inputs.add(local.input);
	for (const selector of selectors) {
		if (selector.kind === "input") inputs.add(selector.name);
	}
	const isLocal = (name: string) => plurals.has(name) || formatted.has(name);
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
			} else if (part.type !== "text") {
				markup = true;
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

function listOf(selectors: readonly Selector[]): string {
	return selectors.length === 0
		? "none"
		: selectors.map((selector) => selector.name).join(", ");
}
