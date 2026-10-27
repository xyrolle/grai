/**
 * A module's loads of other modules at run time: `import(…)`, `require(…)` and Vite's
 * `import.meta.glob(…)`, each by a literal path, a pattern of paths, or nothing the code can show;
 * and a type's import of one, `typeof import("…").key`, which loads nothing at run time but reads
 * the module's exports for its types.
 */

import type { LoadFact, Span } from "./facts.ts";
import type { ESTree } from "./parse.ts";
import type { Scopes } from "./scopes.ts";
import { literalText, type Node } from "./syntax.ts";

/**
 * Whether a node loads a module: `import(…)`, `require(…)` or `import.meta.glob(…)` at run time,
 * or an import type for the types.
 */
export function isLoad(node: Node): boolean {
	return (
		node.type === "ImportExpression" ||
		node.type === "TSImportType" ||
		isRequire(node) ||
		isGlob(node)
	);
}

/**
 * Whether a node the walk took for a load is one, now that the module's scopes are known: a call of
 * a `require` the module declares itself, as a callback's parameter, calls a function of its own.
 */
export function loadsModule(node: Node, scopes: Scopes): boolean {
	return (
		!isRequire(node) ||
		scopes.resolve("require", node.callee.start) === undefined
	);
}

function isRequire(node: Node): node is ESTree.CallExpression {
	return (
		node.type === "CallExpression" &&
		node.callee.type === "Identifier" &&
		node.callee.name === "require" &&
		node.arguments.length === 1
	);
}

/** `import.meta.glob(…)`, which Vite expands into an import of each module the glob matches. */
function isGlob(node: Node): node is ESTree.CallExpression {
	if (node.type !== "CallExpression") return false;
	const callee = node.callee;
	return (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		callee.property.name === "glob" &&
		callee.object.type === "MetaProperty" &&
		callee.object.meta.name === "import" &&
		callee.object.property.name === "meta"
	);
}

/** A load's path: literal, a pattern of its template's text, or none the code can show. */
export function loadFact(
	node: Node,
	span: (node: Span) => Span,
): LoadFact | undefined {
	const argument =
		node.type === "ImportExpression" || node.type === "TSImportType"
			? node.source
			: node.type === "CallExpression"
				? node.arguments[0]
				: undefined;
	if (argument === undefined || argument.type === "SpreadElement")
		return undefined;
	const literal = literalText(argument);
	if (literal !== undefined) {
		return isGlob(node)
			? { at: span(node), pattern: literal }
			: { at: span(argument), source: literal };
	}
	const pattern = patternOf(argument);
	return pattern === undefined ? undefined : { at: span(node), pattern };
}

/**
 * The paths a template or a joined string can be: its literal text, `*` for each value it puts in,
 * which a path's text can be anything without `/` at, as Vite's dynamic import variables read it.
 */
function patternOf(node: Node): string | undefined {
	if (node.type === "TemplateLiteral") {
		return node.quasis.map(({ value }) => value.cooked ?? "").join("*");
	}
	if (node.type === "BinaryExpression" && node.operator === "+") {
		const left = literalText(node.left) ?? patternOf(node.left) ?? "*";
		const right = literalText(node.right) ?? patternOf(node.right) ?? "*";
		return `${left}${right}`;
	}
	return undefined;
}
