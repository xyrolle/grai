import { isRecord } from "./config.ts";
import { parseMatch } from "./match.ts";
import {
	type FormattedLocal,
	parseDeclarations,
} from "./message-declarations.ts";
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

const messageFields = new Set(["declarations", "selectors", "match"]);

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
	const { declared, plurals, formatted } = parseDeclarations(
		stringList(value.declarations ?? [], "declarations"),
	);
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
