/**
 * The rules of JavaScript and TypeScript the scope reader follows: which fields name rather than
 * use, which nodes open a block's scope, which TypeScript nodes are values, and what an assignment
 * writes to.
 */

import type { Node } from "./syntax.ts";

/** The fields that write a name rather than use one, unless the node computes them. */
const nameFields: Readonly<Record<string, readonly string[]>> = {
	MemberExpression: ["property"],
	Property: ["key"],
	MethodDefinition: ["key"],
	PropertyDefinition: ["key"],
	AccessorProperty: ["key"],
	TSPropertySignature: ["key"],
	TSMethodSignature: ["key"],
	LabeledStatement: ["label"],
	BreakStatement: ["label"],
	ContinueStatement: ["label"],
	ExportSpecifier: ["exported"],
	ExportAllDeclaration: ["exported"],
	MetaProperty: ["meta", "property"],
	ImportAttribute: ["key"],
	TSAbstractMethodDefinition: ["key"],
	TSAbstractPropertyDefinition: ["key"],
	TSAbstractAccessorProperty: ["key"],
	TSQualifiedName: ["right"],
	TSImportType: ["qualifier"],
	TSEnumMember: ["id"],
	// A type's own name and a type parameter's declare types, which no value reads.
	TSTypeAliasDeclaration: ["id"],
	TSInterfaceDeclaration: ["id"],
	TSTypeParameter: ["name"],
};

/** TypeScript's nodes that are values or hold them; every other `TS` node is a type. */
const valueNodes: ReadonlySet<string> = new Set([
	"TSAsExpression",
	"TSSatisfiesExpression",
	"TSNonNullExpression",
	"TSTypeAssertion",
	"TSInstantiationExpression",
	"TSEnumDeclaration",
	"TSEnumBody",
	"TSEnumMember",
	"TSModuleDeclaration",
	"TSModuleBlock",
	"TSImportEqualsDeclaration",
	"TSExternalModuleReference",
	"TSExportAssignment",
	"TSParameterProperty",
	"TSDeclareFunction",
	"TSEmptyBodyFunctionExpression",
	"TSAbstractMethodDefinition",
	"TSAbstractPropertyDefinition",
	"TSAbstractAccessorProperty",
]);

/** The nodes that open a block's scope: what `let`, `const` and `class` declare in them stays in them. */
export const blocks: ReadonlySet<string> = new Set([
	"BlockStatement",
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
	"SwitchStatement",
]);

/** What an assignment, an update or a `for … in`/`of` without a declaration writes to. */
export function assignedIn(node: Node): Node | undefined {
	if (node.type === "AssignmentExpression") return node.left;
	if (node.type === "UpdateExpression") return node.argument;
	const loop = node.type === "ForInStatement" || node.type === "ForOfStatement";
	return loop && node.left.type !== "VariableDeclaration"
		? node.left
		: undefined;
}

/** Whether a node is a type: TypeScript's, but its nodes that are values. */
export function isType(node: Node): boolean {
	return node.type.startsWith("TS") && !valueNodes.has(node.type);
}

/** Whether a node's field writes a name: a property's or a label's, not a use of a binding. */
export function writesName(node: Node, field: string): boolean {
	const computed = "computed" in node && node.computed;
	return !computed && (nameFields[node.type]?.includes(field) ?? false);
}

/** Whether a JSX name in this field names a component, which is a use of its binding. */
export function namesElement(node: Node, field: string): boolean {
	if (node.type === "JSXMemberExpression") return field === "object";
	const element =
		node.type === "JSXOpeningElement" || node.type === "JSXClosingElement";
	return element && field === "name";
}

/** The names an assignment's target writes. */
export function writtenNames(target: Node): Node[] {
	switch (target.type) {
		case "Identifier":
			return [target];
		case "ObjectPattern":
			return target.properties.flatMap((property) =>
				writtenNames(
					property.type === "RestElement" ? property.argument : property.value,
				),
			);
		case "ArrayPattern":
			return target.elements.flatMap((element) =>
				element === null ? [] : writtenNames(element),
			);
		case "AssignmentPattern":
			return writtenNames(target.left);
		case "RestElement":
			return writtenNames(target.argument);
		case "TSAsExpression":
		case "TSSatisfiesExpression":
		case "TSNonNullExpression":
		case "TSTypeAssertion":
			return writtenNames(target.expression);
		default:
			return [];
	}
}
