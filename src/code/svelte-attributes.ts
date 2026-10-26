/**
 * The code of a Svelte element's attributes and directives: each expression where Svelte found it,
 * and each name an attribute or directive reads without writing it as an expression. A shorthand
 * stands for a name and the value of the same name (`{title}`, `bind:title`, `class:title`,
 * `style:title`), so it is recorded with how to write it out in full; an action's, transition's or
 * animation's name (`use:tooltip`) reads the function of that name.
 */

import type { AST } from "svelte/compiler";
import type { CodeWriter } from "./source.ts";

/** An attribute of an element or a component, but a `let:`, which the element's scope reads. */
export type Attribute = Exclude<
	AST.ElementLike["attributes"][number],
	AST.LetDirective
>;

/** Writes an attribute's code. */
export function writeAttribute(writer: CodeWriter, attribute: Attribute): void {
	switch (attribute.type) {
		case "Attribute":
		case "StyleDirective": {
			const { value } = attribute;
			if (value === true) {
				if (attribute.type === "StyleDirective")
					shorthandName(writer, attribute);
				return;
			}
			if (!Array.isArray(value) && isShorthand(attribute, value.expression)) {
				written(writer, attribute, spanOf(value.expression));
				return;
			}
			for (const part of Array.isArray(value) ? value : [value]) {
				if (part.type === "ExpressionTag") expression(writer, part.expression);
			}
			return;
		}
		case "BindDirective":
		case "ClassDirective": {
			const value = spanOf(attribute.expression);
			const text = writer.source.slice(attribute.start, attribute.end);
			if (text.includes("=")) expression(writer, attribute.expression);
			else written(writer, attribute, value);
			return;
		}
		case "UseDirective":
		case "TransitionDirective":
		case "AnimateDirective": {
			const start = writer.source.indexOf(":", attribute.start) + 1;
			writer.expression(start, start + attribute.name.length);
			if (attribute.expression !== null)
				expression(writer, attribute.expression);
			return;
		}
		case "OnDirective":
			if (attribute.expression !== null)
				expression(writer, attribute.expression);
			return;
		case "SpreadAttribute":
		case "AttachTag":
			expression(writer, attribute.expression);
	}
}

/** Whether an attribute is `{name}`, its value the name it is called. */
function isShorthand(attribute: AST.BaseNode, value: object): boolean {
	const { start, end } = spanOf(value);
	return start === attribute.start + 1 && end === attribute.end - 1;
}

/** `style:name` without a value, which reads the name, if it is a name. */
function shorthandName(writer: CodeWriter, attribute: AST.StyleDirective) {
	if (!/^[A-Za-z_$][\w$]*$/.test(attribute.name)) return;
	const start = writer.source.indexOf(":", attribute.start) + 1;
	written(writer, attribute, { start, end: start + attribute.name.length });
}

/** A shorthand's name, as an expression, written out in full as `…={name}` around another. */
function written(
	writer: CodeWriter,
	attribute: AST.BaseNode & { name: string },
	name: { start: number; end: number },
): void {
	const text = writer.source.slice(attribute.start, attribute.end);
	const full = text.startsWith("{") ? attribute.name : text;
	writer.shorthand(name.start, name.end, {
		replaces: { start: attribute.start, end: attribute.end },
		before: `${full}={`,
		after: "}",
	});
}

function expression(writer: CodeWriter, node: object): void {
	const { start, end } = spanOf(node);
	writer.expression(start, end);
}

/** Where a node of Svelte's tree is in the component, which every node it parses carries. */
export function spanOf(node: object): { start: number; end: number } {
	const start =
		"start" in node && typeof node.start === "number" ? node.start : 0;
	const end = "end" in node && typeof node.end === "number" ? node.end : start;
	return { start, end };
}
