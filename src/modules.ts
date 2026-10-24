import type { Formatter } from "./formatters.ts";
import {
	arrow,
	functionExpression,
	localeFunction,
	type Used,
} from "./locale-function.ts";
import type { LocaleMessage } from "./message.ts";
import { plainText } from "./pattern.ts";

/** The runtime functions compiled messages call. */
export type RuntimeFunction = "markup" | "message" | "text" | "unmatched";

/**
 * A key compiled: its line in keys.js and in a server build, the runtime functions, plurals.js's
 * functions and the formatters it calls, and its parts one locale at a time, for an adapter that
 * writes a module per locale.
 */
export type KeyModule = {
	/** Its line in keys.js, each locale's function an arrow function. */
	code: string;
	/** Its line in a server build, each locale's function a function expression. */
	serverCode: string;
	uses: ReadonlySet<RuntimeFunction>;
	/** The functions of plurals.js it calls, by name. */
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
		const code = exportCode(key, "text", texts, []);
		return {
			code,
			serverCode: code,
			...used,
			kind: "text",
			variants: texts,
			parts: [],
		};
	}
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
		code: exportCode(key, kind, variants, partArrows),
		serverCode: exportCode(
			key,
			kind,
			strings.map(functionExpression),
			parts.map(functionExpression),
		),
		...used,
		kind,
		variants,
		parts: partArrows,
	};
}

/** A key's export: the runtime call that holds its variants, and for markup its parts. */
function exportCode(
	key: string,
	kind: KeyModule["kind"],
	variants: readonly string[],
	parts: readonly string[],
): string {
	const call =
		kind === "markup"
			? `markup([${variants.join(", ")}], [${parts.join(", ")}])`
			: `${kind}(${variants.join(", ")})`;
	return `export const ${key} = /*#__PURE__*/ ${call};\n`;
}
