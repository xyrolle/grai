import type { ESTree } from "vite";
import type { MappedKey } from "../import/mapping.ts";
import type { Outcome } from "./library.ts";
import type { Span } from "./syntax.ts";

/** What a source library's call passes on to grai's: the inputs, written in an object, and the locale. */
export type CallInputs = {
	/** The properties that pass inputs, each by the name it gives. */
	inputs: ReadonlyMap<string, ESTree.ObjectProperty>;
	/** The object they are written in, kept as it is when it holds nothing else. */
	object: ESTree.ObjectExpression | undefined;
	/** The expression the call's locale is, when it names one. */
	locale: string | undefined;
};

/**
 * The grai call that replaces a span: `m.key(inputs)`, with `{ locale }` when the call names one.
 * A message with markup, or a call that misses an input the message reads or passes one it does
 * not, stays for a person, who knows what the call means.
 */
export function messageCall(
	replace: Span,
	mapped: MappedKey,
	{ inputs, object, locale }: CallInputs,
	text: string,
): Outcome {
	if (mapped.markup) {
		return { left: "the message has markup: render its .parts() instead." };
	}
	const missing = mapped.inputs.filter((name) => !inputs.has(name));
	if (missing.length > 0) {
		return {
			left: `the message reads ${listed(missing)}, which the call does not pass.`,
		};
	}
	const extra = [...inputs.keys()].filter(
		(name) => !mapped.inputs.includes(name),
	);
	if (extra.length > 0) {
		return {
			left: `it passes ${listed(extra)}, which the message does not read: remove ${extra.length === 1 ? "it" : "them"}.`,
		};
	}
	const source = (node: Span) => text.slice(node.start, node.end);
	const properties = [...inputs.values()];
	const written =
		object !== undefined && object.properties.length === properties.length
			? source(object)
			: `{ ${properties.map(source).join(", ")} }`;
	const options =
		locale === undefined
			? ""
			: `, { ${locale === "locale" ? locale : `locale: ${locale}`} }`;
	const args = properties.length > 0 ? written : options === "" ? "" : "{}";
	return { replace, text: `m.${mapped.key}(${args}${options})` };
}

/** Names as a sentence lists them: `a`, `a and b`, `a, b and c`. */
function listed(names: readonly string[]): string {
	const last = names.at(-1) ?? "";
	return names.length < 2
		? last
		: `${names.slice(0, -1).join(", ")} and ${last}`;
}
