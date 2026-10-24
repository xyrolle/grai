import type { LocaleMessage } from "./message.ts";
import { type Part, plainText } from "./pattern.ts";
import { pluralName } from "./plurals.ts";
import { catchAll, type Selector } from "./selection.ts";

/** The runtime functions compiled messages call. */
export type RuntimeFunction = "markup" | "message" | "text" | "unmatched";

/**
 * A key compiled: its line in keys.js, the runtime functions and the locales' plural functions it
 * calls, and its parts one locale at a time, for an adapter that writes a module per locale.
 */
export type KeyModule = {
	code: string;
	uses: ReadonlySet<RuntimeFunction>;
	plurals: ReadonlySet<string>;
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
	const used: Used = { uses: new Set(), plurals: new Set() };
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

/** What a key's code calls: runtime functions, and the plural functions of locales. */
type Used = { uses: Set<RuntimeFunction>; plurals: Set<string> };

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
	const branches = variants.map((variant) => ({
		condition: conditionCode(variant.keys, message.selectors, value),
		pattern: patternCode(variant.pattern, mode, value),
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
	value: (name: string) => string,
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
	value: (name: string) => string,
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

function patternCode(
	pattern: readonly Part[],
	mode: Mode,
	value: (name: string) => string,
): string {
	if (mode === "parts") {
		return `[${pattern.map((part) => partCode(part, value)).join(", ")}]`;
	}
	if (!pattern.some((part) => part.type === "variable")) {
		return JSON.stringify(plainText(pattern));
	}
	let template = "";
	for (const part of pattern) {
		if (part.type === "text") template += templateText(part.value);
		else if (part.type === "variable") template += `\${${value(part.name)}}`;
	}
	return `\`${template}\``;
}

function partCode(part: Part, value: (name: string) => string): string {
	switch (part.type) {
		case "text":
			return `{ type: "text", value: ${JSON.stringify(part.value)} }`;
		case "variable":
			return `{ type: "text", value: String(${value(part.name)}) }`;
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
