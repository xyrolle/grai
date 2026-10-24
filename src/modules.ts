import type { Formatter } from "./formatters.ts";
import { localeFunction, type Used } from "./locale-function.ts";
import type { LocaleMessage } from "./message.ts";
import { plainText } from "./pattern.ts";

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
