import type { Format } from "./format-options.ts";
import { type Formatter, formatterOf } from "./formatters.ts";
import { literalKey } from "./literal-key.ts";
import { localeReads, shiftedCode } from "./locale-reads.ts";
import type { MarkupPart } from "./markup.ts";
import type { LocaleMessage } from "./message.ts";
import type { RuntimeFunction } from "./modules.ts";
import {
	formatsLiteral,
	type LiteralPart,
	type Part,
	plainText,
} from "./pattern.ts";
import { catchAll } from "./selection.ts";

type Mode = "string" | "parts";

/** What a key's code calls: runtime functions, plurals.js's functions and formatters, by name. */
export type Used = {
	uses: Set<RuntimeFunction>;
	plurals: Set<string>;
	formats: Map<string, Formatter>;
};

/** The code of an input, or of a local, by its name. */
type Value = (name: string) => string;

/**
 * One locale's function of the inputs: its parameter, the plural locals it declares, and the
 * expression it returns.
 */
export type LocaleFunction = {
	parameter: string;
	declarations: string;
	body: string;
};

/** A locale's function as an arrow function, the shortest to send a browser. */
export function arrow({
	parameter,
	declarations,
	body,
}: LocaleFunction): string {
	return declarations === ""
		? `(${parameter}) => ${body}`
		: `(${parameter}) => { ${declarations}return ${body}; }`;
}

/**
 * A locale's function as a function expression, which a server loads faster: V8 pre-parses a
 * function expression in a module until its first call, and parses an arrow function in full.
 */
export function functionExpression({
	parameter,
	declarations,
	body,
}: LocaleFunction): string {
	return `function (${parameter}) { ${declarations}return ${body}; }`;
}

/**
 * One locale's function: its variants as a chain of conditions in the order they are tried. The
 * last variant needs no condition, unless a closed select can be given a value it does not list.
 */
export function localeFunction(
	key: string,
	message: LocaleMessage,
	mode: Mode,
	used: Used,
): LocaleFunction {
	const { variants, closed } = message;
	const { value, condition, prologue } = localeReads(message, used);
	/** An operand's code through a format's formatter, moved by what `:offset` adds, with the option an input gives it. */
	const formatted = (format: Format, operand: string) => {
		const formatter = formatterOf(message.locale, format);
		used.formats.set(formatter.name, formatter);
		const given =
			format.input === undefined ? "" : `, ${value(format.input.name)}`;
		const moved =
			format.shift === 0
				? operand
				: `(${shiftedCode(`Number(${operand})`, format.shift)})`;
		return `${formatter.name}(${moved}${given})`;
	};
	/** A placeholder's or a literal's code: its value, through its formatter if it has one. */
	const placeholder = (part: VariablePart | LiteralPart) => {
		if (part.type === "literal") {
			const literal = JSON.stringify(part.value);
			return part.format === undefined
				? literal
				: formatted(part.format, literal);
		}
		const local = message.formatted.get(part.name);
		const format = part.format ?? local?.format;
		const operand = value(local?.input ?? part.name);
		return format === undefined ? operand : formatted(format, operand);
	};
	const branches = variants.map((variant) => ({
		condition: condition(variant.keys),
		pattern: patternCode(variant.pattern, mode, placeholder),
	}));
	let body = closed
		? unmatchedCode(key, message, value, used.uses)
		: (branches.pop()?.pattern ?? "");
	for (const { condition, pattern } of branches.toReversed()) {
		body = `${condition} ? ${pattern} : ${body}`;
	}
	return { ...prologue(), body };
}

/** The call that throws for a value the closed select lists no variant for. */
function unmatchedCode(
	key: string,
	message: LocaleMessage,
	value: Value,
	uses: Set<RuntimeFunction>,
): string {
	uses.add("unmatched");
	const closed = message.selectors.find(
		(selector, index) =>
			selector.kind === "input" &&
			message.variants.every((variant) => variant.keys[index] !== catchAll),
	);
	const name = closed?.name ?? "";
	const input = closed?.kind === "input" ? closed.input : name;
	return `unmatched(${JSON.stringify(key)}, ${JSON.stringify(message.locale)}, ${JSON.stringify(name)}, ${value(input)})`;
}

type VariablePart = Extract<Part, { type: "variable" }>;

/** The code of a placeholder or a literal, given its part. */
type Placeholder = (part: VariablePart | LiteralPart) => string;

function patternCode(
	pattern: readonly Part[],
	mode: Mode,
	placeholder: Placeholder,
): string {
	if (mode === "parts") {
		return `[${pattern.map((part) => partCode(part, placeholder)).join(", ")}]`;
	}
	if (
		!pattern.some((part) => part.type === "variable") &&
		!formatsLiteral(pattern)
	) {
		return JSON.stringify(plainText(pattern));
	}
	let template = "";
	for (const part of pattern) {
		if (part.type === "text") template += templateText(part.value);
		else if (part.type === "literal" && part.format === undefined) {
			template += templateText(part.value);
		} else if (part.type === "variable" || part.type === "literal") {
			template += `\${${placeholder(part)}}`;
		}
	}
	return `\`${template}\``;
}

function partCode(part: Part, placeholder: Placeholder): string {
	switch (part.type) {
		case "text":
			return `{ type: "text", value: ${JSON.stringify(part.value)} }`;
		case "variable":
			return `{ type: "text", value: \`\${${placeholder(part)}}\` }`;
		case "literal":
			return `{ type: "text", value: ${placeholder(part)} }`;
		default:
			return `{ type: "${part.type}", name: ${JSON.stringify(part.name)}, options: ${optionsCode(part, placeholder)}, attributes: ${attributesCode(part)} }`;
	}
}

/** A markup's options as an object: each literal as text, each variable as its value. */
function optionsCode(part: MarkupPart, placeholder: Placeholder): string {
	const entries = [...part.options].map(
		([name, value]) =>
			`${literalKey(name)}: ${"variable" in value ? placeholder({ type: "variable", name: value.variable }) : JSON.stringify(value.literal)}`,
	);
	return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

/** A markup's attributes as an object: each literal as text, an attribute without one as `true`. */
function attributesCode(part: MarkupPart): string {
	const entries = [...part.attributes].map(
		([name, value]) => `${literalKey(name)}:${JSON.stringify(value)}`,
	);
	return `{${entries.join(",")}}`;
}

/** Text as it reads inside a template literal: JSON's escapes, plus the backtick and `${`. */
function templateText(text: string): string {
	return JSON.stringify(text)
		.slice(1, -1)
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}
