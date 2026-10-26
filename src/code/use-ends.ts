/**
 * How a use of an imported value ends, past the names it reads: a read by a computed name, with the
 * names it may be, or a pattern that takes names apart, each with the binding it makes.
 */

import type { Binding, Span, UseEnd } from "./facts.ts";
import type { ESTree } from "./parse.ts";
import type { Scopes } from "./scopes.ts";
import type { Shorthand } from "./source.ts";
import { literalText, type Node } from "./syntax.ts";
import { type FileOf, keySpan } from "./uses.ts";

/**
 * A read by a computed name: the names it may be, those that start with its literal start (a
 * template's text before its first value, or text joined to one), or the literals of a choice.
 */
export function computed(property: Node): {
	prefix: string;
	choices: string[] | undefined;
} {
	if (property.type === "TemplateLiteral") {
		return {
			prefix: property.quasis[0]?.value.cooked ?? "",
			choices: undefined,
		};
	}
	if (property.type === "BinaryExpression" && property.operator === "+") {
		return { prefix: literalText(property.left) ?? "", choices: undefined };
	}
	if (property.type === "ConditionalExpression") {
		const choices = [property.consequent, property.alternate].map(literalText);
		if (choices.every((choice) => choice !== undefined)) {
			return { prefix: "", choices: choices.flatMap((c) => c ?? []) };
		}
	}
	return { prefix: "", choices: undefined };
}

/** The names a pattern takes apart, each with what it binds; a rest, or a computed name, may be any. */
export function pattern(
	node: ESTree.ObjectPattern | ESTree.ObjectAssignmentTarget,
	scopes: Scopes,
	file: FileOf,
): UseEnd {
	const { span } = file;
	const names: Extract<UseEnd, { kind: "pattern" }>["names"] = [];
	let rest: Span | undefined;
	for (const property of node.properties) {
		if (property.type === "RestElement") {
			rest ??= span(property);
			continue;
		}
		const { key } = property;
		const name = property.computed
			? literalText(key)
			: key.type === "Identifier"
				? key.name
				: literalText(key);
		if (name === undefined) {
			rest ??= span(property);
			continue;
		}
		names.push({
			name,
			at: span(keySpan(key)),
			binds: boundBy(property.value, scopes, file),
		});
	}
	return { kind: "pattern", names, rest };
}

/** The name a pattern's value binds, with every reference to it. */
function boundBy(
	value: Node,
	scopes: Scopes,
	file: FileOf,
): Binding | undefined {
	const target = value.type === "AssignmentPattern" ? value.left : value;
	if (target.type !== "Identifier") return undefined;
	const binding = scopes.bindingOf(target);
	if (binding === undefined) return undefined;
	return {
		name: binding.name,
		at: file.span(target),
		references: scopes.usesOf(binding).map(file.reference),
	};
}

/**
 * How a use is written when it is a shorthand property, `{ title }`, which names the property
 * after the binding: in full, `title: …`.
 */
export function propertyShorthand(
	use: Node,
	scopes: Scopes,
	at: Span,
): Shorthand | undefined {
	const parent = scopes.parent(use);
	if (parent?.type !== "Property" || !parent.shorthand || parent.value !== use)
		return undefined;
	const name = use.type === "Identifier" ? use.name : "";
	return { replaces: at, before: `${name}: `, after: "" };
}
