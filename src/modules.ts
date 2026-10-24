import type { LocaleMessage } from "./message.ts";
import { type Part, plainText } from "./pattern.ts";
import { catchAll, type Selector } from "./selection.ts";

/** The runtime functions compiled messages call. */
export type RuntimeFunction =
	| "markup"
	| "message"
	| "plural"
	| "text"
	| "unmatched";

/** A key's line in keys.js, and the runtime functions it calls. */
export type KeyModule = { code: string; uses: ReadonlySet<RuntimeFunction> };

type Mode = "string" | "parts";

/** Compiles one key's messages, one per locale in the config's order, into its export. */
export function keyModule(
	key: string,
	messages: readonly LocaleMessage[],
): KeyModule {
	const uses = new Set<RuntimeFunction>();
	const hasMarkup = messages.some((message) => message.markup);
	const hasInputs = messages.some((message) => message.inputs.size > 0);
	let call: string;
	if (!hasInputs && !hasMarkup) {
		uses.add("text");
		const texts = messages.map((message) =>
			JSON.stringify(plainText(message.variants[0]?.pattern ?? [])),
		);
		call = `text(${texts.join(", ")})`;
	} else {
		const strings = messages.map((message) =>
			localeFunction(key, message, "string", uses),
		);
		if (hasMarkup) {
			const parts = messages.map((message) =>
				localeFunction(key, message, "parts", uses),
			);
			uses.add("markup");
			call = `markup([${strings.join(", ")}], [${parts.join(", ")}])`;
		} else {
			uses.add("message");
			call = `message(${strings.join(", ")})`;
		}
	}
	return { code: `export const ${key} = /*#__PURE__*/ ${call};\n`, uses };
}

/**
 * One locale's function: its variants as a chain of conditions in the order they are tried. The
 * last variant needs no condition, unless a closed select can be given a value it does not list.
 */
function localeFunction(
	key: string,
	message: LocaleMessage,
	mode: Mode,
	uses: Set<RuntimeFunction>,
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
		? unmatchedCode(key, message, value, uses)
		: (branches.pop()?.pattern ?? "");
	for (const { condition, pattern } of branches.toReversed()) {
		body = `${condition} ? ${pattern} : ${body}`;
	}
	const locals = [...message.plurals].filter(([name]) => reads.has(name));
	if (locals.length > 0) uses.add("plural");
	const declarations = locals.map(
		([name, counted]) =>
			`const $${name} = plural(${JSON.stringify(message.locale)}, ${value(counted)}); `,
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
