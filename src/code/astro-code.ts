/**
 * An Astro component's code, read through the parser the project's Astro builds with: its
 * frontmatter as it is, then its template's expressions, each where Astro found it, as one module;
 * and each `<script>`, which Astro bundles as a module of its own. A template's expression is
 * JavaScript, JSX included, so the scopes it opens are its own: `{items.map((m) => …)}`.
 */

import type { AstroParse } from "./frameworks.ts";
import { type CodeError, CodeWriter, type SourceCode } from "./source.ts";
import {
	child,
	field,
	fields,
	isTreeNode,
	number,
	type TreeNode,
	text,
} from "./tree.ts";

/** A component's modules, or the first error of a component Astro cannot parse. */
export function astroCode(
	source: string,
	parse: AstroParse,
): SourceCode[] | CodeError {
	const result = parse(source);
	const diagnostics = field(result, "diagnostics");
	for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
		if (field(diagnostic, "severity") !== "error") continue;
		const [label] = [field(diagnostic, "labels")].flat();
		const at = field(label, "start");
		const message = field(diagnostic, "text");
		return {
			at: typeof at === "number" ? at : 0,
			message: typeof message === "string" ? message : "Astro cannot parse it",
		};
	}
	const writer = new CodeWriter(source);
	const ast = field(result, "ast");
	const program = child(child(ast, "frontmatter"), "program");
	if (program !== undefined) piece(writer, program).write("\n;\n");
	const scripts: SourceCode[] = [];
	const visit = (node: TreeNode) => {
		if (node.type === "JSXAttribute" && shorthand(writer, node)) return;
		if (node.type === "JSXExpressionContainer") {
			const expression = child(node, "expression");
			if (
				expression?.type !== "JSXEmptyExpression" &&
				expression !== undefined
			) {
				expressionOf(writer, expression);
			}
			return;
		}
		if (node.type === "JSXSpreadAttribute" || node.type === "JSXSpreadChild") {
			const spread = child(node, "argument") ?? child(node, "expression");
			if (spread !== undefined) expressionOf(writer, spread);
			return;
		}
		if (node.type === "AstroScript") {
			const script = child(node, "program");
			if (script !== undefined) {
				scripts.push(piece(new CodeWriter(source), script).code("ts"));
			}
			return;
		}
		if (node.type === "JSXOpeningElement") {
			const name = child(node, "name");
			if (name !== undefined && namesComponent(name))
				expressionOf(writer, name);
		}
		for (const [field, item] of fields(node)) {
			if (field !== "name") visit(item);
		}
	};
	if (isTreeNode(ast)) {
		for (const [, node] of fields(ast)) {
			if (node.type !== "AstroFrontmatter") visit(node);
		}
	}
	return [writer.code("tsx"), ...scripts];
}

/**
 * Writes an attribute that is `{name}`, Astro's shorthand for the name and the value of the same
 * name, as that name, and how to write it out in full; whether it is one.
 */
function shorthand(writer: CodeWriter, attribute: TreeNode): boolean {
	const value = child(attribute, "value");
	const name = child(value, "expression");
	const start = number(attribute, "start");
	const end = number(attribute, "end");
	if (
		value?.type !== "JSXExpressionContainer" ||
		name?.type !== "Identifier" ||
		start === undefined ||
		end === undefined ||
		number(value, "start") !== start
	) {
		return false;
	}
	writer.shorthand(number(name, "start") ?? 0, number(name, "end") ?? 0, {
		replaces: { start, end },
		before: `${text(name, "name") ?? ""}={`,
		after: "}",
	});
	return true;
}

/** Whether an element's name names a binding, as a component's does, not an HTML tag. */
function namesComponent(name: TreeNode): boolean {
	if (name.type === "JSXMemberExpression") return true;
	const identifier = name.type === "JSXIdentifier" ? text(name, "name") : "";
	return /^[A-Z]/.test(identifier ?? "");
}

function piece(writer: CodeWriter, node: TreeNode): CodeWriter {
	return writer.piece(number(node, "start") ?? 0, number(node, "end") ?? 0);
}

function expressionOf(writer: CodeWriter, node: TreeNode): void {
	writer.expression(number(node, "start") ?? 0, number(node, "end") ?? 0);
}
