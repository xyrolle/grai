import type { Formatter } from "./formatters.ts";
import {
	arrow,
	functionExpression,
	type LocaleFunction,
	localeFunction,
	type Used,
} from "./locale-function.ts";
import type { LocaleMessage } from "./message.ts";
import { formatsLiteral, plainText } from "./pattern.ts";
import { serverMessage } from "./server-message.ts";

/** The runtime functions compiled messages call. */
export type RuntimeFunction =
	| "localeIndex"
	| "markup"
	| "message"
	| "text"
	| "unmatched";

/**
 * A key compiled: the value its module exports, in keys.js and in a server build, the runtime
 * functions, plurals.js's functions, formatters and globals it calls, which are every name its
 * code refers to, and its parts one locale at a time, for an adapter that writes a module per
 * locale.
 */
export type KeyModule = {
	/** Its value in keys.js, each locale's function an arrow function. */
	value: string;
	/**
	 * Its value in a server build: a message with inputs switches on the call's locale in its own
	 * code (server-message.ts); any other key is its value in keys.js, each locale's function a
	 * function expression.
	 */
	serverValue: string;
	uses: ReadonlySet<RuntimeFunction>;
	/** The runtime functions its value in a server build calls. */
	serverUses: ReadonlySet<RuntimeFunction>;
	/** The functions of plurals.js it calls, by name. */
	plurals: ReadonlySet<string>;
	/** The formatters it calls, by name. */
	formats: ReadonlyMap<string, Formatter>;
	/** The globals it calls, such as `String`. */
	globals: ReadonlySet<string>;
	/** How the dispatcher holds the key: a string per locale, or a function per locale, with parts. */
	kind: "text" | "message" | "markup";
	/** Per locale, in the config's order: a string literal for text, else a function of the inputs. */
	variants: readonly string[];
	/** Per locale, for markup: a function of the inputs giving the parts. */
	parts: readonly string[];
};

/** What every text key calls: the runtime's `text`, and nothing else, shared by them all. */
const textUses: ReadonlySet<RuntimeFunction> = new Set(["text"]);
const noNames: ReadonlySet<string> = new Set();
const noFormats: ReadonlyMap<string, Formatter> = new Map();

/** Compiles one key's messages, one per locale in the config's order, into the value its module exports. */
export function keyModule(
	key: string,
	messages: readonly LocaleMessage[],
): KeyModule {
	const hasMarkup = messages.some((message) => message.markup);
	const hasInputs = messages.some((message) => message.inputs.size > 0);
	// A literal a function formats is the locale's to format each call, so it needs a function too.
	const formats = messages.some(({ variants }) =>
		variants.some(({ pattern }) => formatsLiteral(pattern)),
	);
	if (!hasInputs && !hasMarkup && !formats) {
		return textModule(
			messages.map((message) => plainText(message.variants[0]?.pattern ?? [])),
		);
	}
	const used: Used = {
		uses: new Set(),
		plurals: new Set(),
		formats: new Map(),
		globals: new Set(),
	};
	const kind = hasMarkup ? "markup" : "message";
	used.uses.add(kind);
	const strings = messages.map((message) =>
		localeFunction(key, message, "string", used),
	);
	const parts = hasMarkup
		? messages.map((message) => localeFunction(key, message, "parts", used))
		: [];
	const variants = strings.map(arrow);
	const partArrows = parts.map(arrow);
	return {
		value: messageValue(kind, variants, partArrows),
		...serverModule(key, kind, strings, parts, used),
		...used,
		kind,
		variants,
		parts: partArrows,
	};
}

/**
 * A key whose message is a text in every locale, one per locale in the config's order: a string per
 * locale, which every build and dev module holds as it is.
 */
export function textModule(texts: readonly string[]): KeyModule {
	const variants = texts.map((text) => JSON.stringify(text));
	const value = messageValue("text", variants, []);
	return {
		value,
		serverValue: value,
		uses: textUses,
		serverUses: textUses,
		plurals: noNames,
		formats: noFormats,
		globals: noNames,
		kind: "text",
		variants,
		parts: [],
	};
}

/**
 * A message's value in a server build, and the runtime functions it calls. One with inputs
 * switches on the call's locale in its own code; one with markup is its value in keys.js, each
 * locale's function a function expression.
 */
function serverModule(
	key: string,
	kind: "message" | "markup",
	strings: readonly LocaleFunction[],
	parts: readonly LocaleFunction[],
	used: Used,
): Pick<KeyModule, "serverValue" | "serverUses"> {
	if (kind === "markup")
		return {
			serverValue: messageValue(
				kind,
				strings.map(functionExpression),
				parts.map(functionExpression),
			),
			serverUses: used.uses,
		};
	const uses = new Set(used.uses);
	uses.delete("message");
	uses.add("localeIndex");
	// Every name its code refers to, the key's own too: its options take none of them.
	const bound = new Set<string>([
		key,
		...uses,
		...used.plurals,
		...used.formats.keys(),
		...used.globals,
	]);
	return { serverValue: serverMessage(strings, bound), serverUses: uses };
}

/** A key's value: the runtime call that holds its variants, and for markup its parts. */
function messageValue(
	kind: KeyModule["kind"],
	variants: readonly string[],
	parts: readonly string[],
): string {
	const call =
		kind === "markup"
			? `markup([${variants.join(", ")}], [${parts.join(", ")}])`
			: `${kind}(${variants.join(", ")})`;
	return `/*#__PURE__*/ ${call}`;
}
