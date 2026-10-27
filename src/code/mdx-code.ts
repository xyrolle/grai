/**
 * An MDX document's code, read through MDX's own parser: its `import` and `export` blocks as they
 * are, then its expressions, its JSX attributes' expressions and its components' names, each where
 * MDX found it, as one module. Markdown text is no code, and an expression's scopes are its own. An
 * expression that holds only a comment, as a translator's note does, is no code either, as MDX
 * compiles it to nothing.
 */

import type { MdxParse } from "./frameworks.ts";
import { CodeWriter, type SourceCode } from "./source.ts";
import {
	child,
	children,
	field,
	isTreeNode,
	type TreeNode,
	text,
} from "./tree.ts";

/** A document's code; throws MDX's error for a document MDX cannot parse. */
export function mdxCode(source: string, parse: MdxParse): SourceCode {
	const writer = new CodeWriter(source);
	const root = parse(source);
	const visit = (node: TreeNode) => {
		const { start, end } = spanOf(node);
		if (node.type === "mdxjsEsm") {
			writer.piece(start, end).write("\n;\n");
		} else if (
			(node.type === "mdxFlowExpression" ||
				node.type === "mdxTextExpression") &&
			!holdsNoCode(node)
		) {
			writer.expression(start + 1, end - 1);
		} else if (
			node.type === "mdxJsxFlowElement" ||
			node.type === "mdxJsxTextElement"
		) {
			const name = text(node, "name") ?? "";
			if (/^[A-Z]|\./.test(name))
				writer.expression(start + 1, start + 1 + name.length);
			for (const attribute of children(node, "attributes")) {
				attributeCode(writer, attribute);
			}
		}
		for (const item of children(node, "children")) visit(item);
	};
	if (isTreeNode(root)) {
		for (const item of children(root, "children")) visit(item);
	}
	return writer.code("jsx");
}

/** An attribute's expression, `name={…}`, or a spread of one, `{...…}`. */
function attributeCode(writer: CodeWriter, attribute: TreeNode): void {
	const { start, end } = spanOf(attribute);
	if (attribute.type === "mdxJsxExpressionAttribute") {
		writer
			.write("({\n")
			.piece(start + 1, end - 1)
			.write("\n});\n");
		return;
	}
	const value = child(attribute, "value");
	const expression = value === undefined ? undefined : text(value, "value");
	if (expression !== undefined) {
		writer.expression(end - 1 - expression.length, end - 1);
	}
}

/** Whether an expression's program, as MDX parsed it, has no statement: it holds comments alone. */
function holdsNoCode(node: TreeNode): boolean {
	const body = field(field(field(node, "data"), "estree"), "body");
	return Array.isArray(body) && body.length === 0;
}

/** Where a node of MDX's tree is in the document, by its position's offsets. */
function spanOf(node: TreeNode): { start: number; end: number } {
	const position = field(node, "position");
	const start = field(field(position, "start"), "offset");
	const end = field(field(position, "end"), "offset");
	return {
		start: typeof start === "number" ? start : 0,
		end: typeof end === "number" ? end : 0,
	};
}
