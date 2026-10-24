import { type Formatter, formatterOf } from "./formats.ts";
import type { LocaleMessage } from "./message.ts";
import { type Part, plainText } from "./pattern.ts";
import { pluralName } from "./plurals.ts";
import { catchAll, type Selector } from "./selection.ts";

/** The runtime functions compiled messages call. */
export type RuntimeFunction = "markup" | "message" | "text" | "unmatched";

/**
 * A key compiled: its line in keys.js, the runtime functions, the locales' plural functions and the
 * formatters it calls, and its parts one locale at a time, for an adapter that writes a module per
 * locale.
 */
export type KeyModule = {
	code: string;
	uses: ReadonlySet<RuntimeFunction>;
	plurals: ReadonlySet<string>;
	/** The formatters it calls, by name. */
	formats: ReadonlyMap<string, Formatter>;
	/** How the dispatcher holds the key: a string per locale, or a function per locale, with parts. */
	kind: "text" | "message" | "markup";
	/** Per locale, in the config's order: a string literal for text, else a function of the inputs. */
	variants: readonly string[];
	/** Per locale, for markup: a function of the inputs giving the parts. */
	parts: readonly string[];
};

type Mode = "string" | "parts";

/** Compiles one key's messages, one per locale in the config's order, into its export. */
export function keyModule(
	key: string,
	messages: readonly LocaleMessage[],
): KeyModule {
	const used: Used = {
		uses: new Set(),
		plurals: new Set(),
		formats: new Map(),
	};
	const hasMarkup = messages.some((message) => message.markup);
	const hasInputs = messages.some((message) => message.inputs.size > 0);
	if (!hasInputs && !hasMarkup) {
		used.uses.add("text");
		const texts = messages.map((message) =>
			JSON.stringify(plainText(message.variants[0]?.pattern ?? [])),
		);
		return keyCode(key, "text", texts, [], used);
	}
	const strings = messages.map((message) =>
		localeFunction(key, message, "string", used),
	);
	if (!hasMarkup) {
		used.uses.add("message");
		return keyCode(key, "message", strings, [], used);
	}
	const parts = messages.map((message) =>
		localeFunction(key, message, "parts", used),
	);
	used.uses.add("markup");
	return keyCode(key, "markup", strings, parts, used);
}

function keyCode(
	key: string,
	kind: KeyModule["kind"],
	variants: readonly string[],
	parts: readonly string[],
	used: Used,
): KeyModule {
	const call =
		kind === "markup"
			? `markup([${variants.join(", ")}], [${parts.join(", ")}])`
			: `${kind}(${variants.join(", ")})`;
	return {
		code: `export const ${key} = /*#__PURE__*/ ${call};\n`,
		...used,
		kind,
		variants,
		parts,
	};
}

/** What a key's code calls: runtime functions, the plural functions of locales, and formatters. */
type Used = {
	uses: Set<RuntimeFunction>;
	plurals: Set<string>;
	formats: Map<string, Formatter>;
};

/** The code of an input, or of a local, by its name. */
type Value = (name: string) => string;

/**
 * One locale's function: its variants as a chain of conditions in the order they are tried. The
 * last variant needs no condition, unless a closed select can be given a value it does not list.
 */
function localeFunction(
	key: string,
	message: LocaleMessage,
	mode: Mode,
	used: Used,
): string {
	const { variants, closed } = message;
	const reads = new Set<string>();
	const value = (name: string) => {
		reads.add(name);
		return message.plurals.has(name) ? `$${name}` : `i.${name}`;
	};
	/** A placeholder's code: its value, through its formatter if it has one. */
	const placeholder = (part: VariablePart) => {
		const local = message.formatted.get(part.name);
		const format = part.format ?? local?.format;
		const operand = value(local?.input ?? part.name);
		if (format === undefined) return operand;
		const formatter = formatterOf(message.locale, format);
		used.formats.set(formatter.name, formatter);
		return `${formatter.name}(${operand})`;
	};
	const branches = variants.map((variant) => ({
		condition: conditionCode(variant.keys, message.selectors, value),
		pattern: patternCode(variant.pattern, mode, placeholder),
	}));
	let body = closed
		? unmatchedCode(key, message, value, used.uses)
		: (branches.pop()?.pattern ?? "");
	for (const { condition, pattern } of branches.toReversed()) {
		body = `${condition} ? ${pattern} : ${body}`;
	}
	const locals = [...message.plurals].filter(([name]) => reads.has(name));
	if (locals.length > 0) used.plurals.add(message.locale);
	const declarations = locals.map(
		([name, counted]) =>
			`const $${name} = ${pluralName(message.locale)}(${value(counted)}); `,
	);
	const parameter = [...reads].some((name) => !message.plurals.has(name))
		? "i"
		: "";
	return declarations.length === 0
		? `(${parameter}) => ${body}`
		: `(${parameter}) => { ${declarations.join("")}return ${body}; }`;
}

/** The test a variant's keys put on the selectors; empty when every key is `*`. */
function conditionCode(
	keys: readonly string[],
	selectors: readonly Selector[],
	value: Value,
): string {
	const tests: string[] = [];
	keys.forEach((key, index) => {
		const selector = selectors[index];
		if (key === catchAll || selector === undefined) return;
		tests.push(
			selector.kind === "plural"
				? `${value(selector.name)} === ${JSON.stringify(key)}`
				: `String(${value(selector.name)}) === ${JSON.stringify(key)}`,
		);
	});
	return tests.join(" && ");
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
	return `unmatched(${JSON.stringify(key)}, ${JSON.stringify(message.locale)}, ${JSON.stringify(name)}, ${value(name)})`;
}

type VariablePart = Extract<Part, { type: "variable" }>;

/** The code of a placeholder, given its part. */
type Placeholder = (part: VariablePart) => string;

function patternCode(
	pattern: readonly Part[],
	mode: Mode,
	placeholder: Placeholder,
): string {
	if (mode === "parts") {
		return `[${pattern.map((part) => partCode(part, placeholder)).join(", ")}]`;
	}
	if (!pattern.some((part) => part.type === "variable")) {
		return JSON.stringify(plainText(pattern));
	}
	let template = "";
	for (const part of pattern) {
		if (part.type === "text") template += templateText(part.value);
		else if (part.type === "variable") template += `\${${placeholder(part)}}`;
	}
	return `\`${template}\``;
}

function partCode(part: Part, placeholder: Placeholder): string {
	switch (part.type) {
		case "text":
			return `{ type: "text", value: ${JSON.stringify(part.value)} }`;
		case "variable":
			return `{ type: "text", value: String(${placeholder(part)}) }`;
		default:
			return `{ type: "${part.type}", name: ${JSON.stringify(part.name)}, options: {}, attributes: {} }`;
	}
}

/** Text as it reads inside a template literal: JSON's escapes, plus the backtick and `${`. */
function templateText(text: string): string {
	return JSON.stringify(text)
		.slice(1, -1)
		.replaceAll("`", "\\`")
		.replaceAll("${", "\\${");
}
