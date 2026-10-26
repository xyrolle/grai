import type { ESTree } from "../code/parse.ts";
import type { Node, Span } from "../code/syntax.ts";
import type { MappedKey } from "../import/mapping.ts";
import type { Left, ModuleView, Outcome } from "./library.ts";

/** What a source library's call passes on to grai's: the inputs, written in an object, and the locale. */
export type CallInputs = {
	/** The properties that pass inputs, each by the name it gives. */
	inputs: ReadonlyMap<string, ESTree.ObjectProperty>;
	/** The object they are written in, kept as it is when it holds nothing else. */
	object: ESTree.ObjectExpression | undefined;
	/** The expression the call's locale is, when it or its translator names one. */
	locale: Node | undefined;
};

/**
 * The grai call that replaces a span: `m.key(inputs)`, with `{ locale }` when the call or its
 * translator names one. A message with markup, or a call that misses an input the message reads or
 * passes one it does not, stays for a person, who knows what the call means. So does a call where
 * its translator's locale, copied into it, would read another declaration of its name.
 */
export function messageCall(
	replace: Span,
	mapped: MappedKey,
	{ inputs, object, locale }: CallInputs,
	{ text, scopes }: ModuleView,
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
	if (
		locale?.type === "Identifier" &&
		scopes.resolve(locale.name, replace.start) !==
			scopes.resolve(locale.name, locale.start)
	) {
		return shadowedLocale(locale.name);
	}
	const source = (node: Span) => text.slice(node.start, node.end);
	const properties = [...inputs.values()];
	const written =
		object !== undefined && object.properties.length === properties.length
			? source(object)
			: `{ ${properties.map(source).join(", ")} }`;
	const named = locale && source(locale);
	const options =
		named === undefined
			? ""
			: `, { ${named === "locale" ? named : `locale: ${named}`} }`;
	const args = properties.length > 0 ? written : options === "" ? "" : "{}";
	return { replace, text: `m.${mapped.key}(${args}${options})` };
}

/** Why a call stays: its translator's locale is a name another declaration takes where the call is. */
function shadowedLocale(name: string): Left {
	return {
		left: `its locale, the name ${name}, means something else here: rename one of the two, then run grai migrate again.`,
	};
}

/** Names as a sentence lists them: `a`, `a and b`, `a, b and c`. */
function listed(names: readonly string[]): string {
	const last = names.at(-1) ?? "";
	return names.length < 2
		? last
		: `${names.slice(0, -1).join(", ")} and ${last}`;
}
