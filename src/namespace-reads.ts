/**
 * The keys a module reads through a namespace it imports, by scope: `m.key`, `m?.key` and
 * `m["key"]` where `m` is the import, not a parameter, a variable, a function, a class or a caught
 * error that a nearer scope declares by the same name. Read from the module's ESTree program.
 */

import {
	child,
	identifierName,
	isTreeNode,
	type TreeNode,
} from "./svelte-tree.ts";

/** A key a namespace's member names: the key, and where the member and the key's name are. */
export type NamespaceRead = {
	key: string;
	start: number;
	end: number;
	keyStart: number;
};

const functions: ReadonlySet<string> = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunctionExpression",
]);

/** Fields that hold only types, which read no value. */
const typeFields: ReadonlySet<string> = new Set([
	"typeAnnotation",
	"returnType",
	"typeParameters",
	"typeArguments",
	"superTypeArguments",
	"implements",
]);

/** Each read of a key through one of the namespaces the program imports by these names. */
export function namespaceReads(
	program: TreeNode,
	namespaces: ReadonlySet<string>,
): NamespaceRead[] {
	const reads: NamespaceRead[] = [];
	const visit = (node: TreeNode, shadowed: ReadonlySet<string>) => {
		const inner = withDeclarations(node, shadowed, namespaces);
		if (node.type === "MemberExpression") {
			const read = memberRead(node, inner, namespaces);
			if (read !== undefined) reads.push(read);
		}
		for (const [field, value] of Object.entries(node)) {
			if (typeFields.has(field)) continue;
			for (const item of Array.isArray(value) ? value : [value]) {
				if (isTreeNode(item)) visit(item, inner);
			}
		}
	};
	visit(program, new Set());
	return reads;
}

/** The key a member names through an unshadowed namespace, if it is one. */
function memberRead(
	node: TreeNode,
	shadowed: ReadonlySet<string>,
	namespaces: ReadonlySet<string>,
): NamespaceRead | undefined {
	const name = identifierName(child(node, "object"));
	if (name === undefined || !namespaces.has(name) || shadowed.has(name))
		return undefined;
	const property = child(node, "property");
	const start = numberOf(node, "start");
	const end = numberOf(node, "end");
	const at = property === undefined ? undefined : numberOf(property, "start");
	if (start === undefined || end === undefined || at === undefined)
		return undefined;
	if (node.computed !== true) {
		const key = identifierName(property);
		return key === undefined ? undefined : { key, start, end, keyStart: at };
	}
	const literal = property?.type === "Literal" ? property.value : undefined;
	return typeof literal === "string"
		? { key: literal, start, end, keyStart: at + 1 }
		: undefined;
}

/** The names shadowed inside a node: those it declares that are the namespaces' names. */
function withDeclarations(
	node: TreeNode,
	shadowed: ReadonlySet<string>,
	namespaces: ReadonlySet<string>,
): ReadonlySet<string> {
	const declared = declaredIn(node).filter((name) => namespaces.has(name));
	return declared.length === 0 ? shadowed : new Set([...shadowed, ...declared]);
}

/** The names a node declares for its own scope. */
function declaredIn(node: TreeNode): string[] {
	if (functions.has(node.type)) {
		const own = node.type === "FunctionExpression" ? [child(node, "id")] : [];
		const parameters = Array.isArray(node.params) ? node.params : [];
		return [
			...[...own, ...parameters].flatMap(boundNames),
			...hoisted(child(node, "body")),
		];
	}
	if (node.type === "ClassExpression") return boundNames(child(node, "id"));
	if (node.type === "CatchClause") return boundNames(child(node, "param"));
	if (node.type === "BlockStatement" || node.type === "Program") {
		return lexical(Array.isArray(node.body) ? node.body : []);
	}
	if (node.type === "SwitchStatement" && Array.isArray(node.cases)) {
		return node.cases.flatMap((each) =>
			isTreeNode(each) && Array.isArray(each.consequent)
				? lexical(each.consequent)
				: [],
		);
	}
	if (/^For(?:In|Of)?Statement$/.test(node.type)) {
		const head = child(node, node.type === "ForStatement" ? "init" : "left");
		return head === undefined ? [] : lexical([head]);
	}
	return [];
}

/** The names a list of statements declares with let, const, class or a function declaration. */
function lexical(statements: readonly unknown[]): string[] {
	return statements.flatMap((statement) => {
		const node = exported(statement);
		if (node === undefined) return [];
		if (node.type === "VariableDeclaration" && node.kind !== "var")
			return declarators(node);
		if (node.type === "ClassDeclaration" || node.type === "FunctionDeclaration")
			return boundNames(child(node, "id"));
		return [];
	});
}

/** The `var` names a function's body declares anywhere outside its nested functions. */
function hoisted(body: TreeNode | undefined): string[] {
	if (body === undefined) return [];
	const names: string[] = [];
	const visit = (node: TreeNode) => {
		if (functions.has(node.type)) return;
		if (node.type === "VariableDeclaration" && node.kind === "var")
			names.push(...declarators(node));
		for (const value of Object.values(node)) {
			for (const item of Array.isArray(value) ? value : [value]) {
				if (isTreeNode(item)) visit(item);
			}
		}
	};
	visit(body);
	return names;
}

function declarators(declaration: TreeNode): string[] {
	const list = Array.isArray(declaration.declarations)
		? declaration.declarations
		: [];
	return list.flatMap((each) =>
		isTreeNode(each) ? boundNames(child(each, "id")) : [],
	);
}

/** The names a pattern binds: an identifier, or the names in a destructuring, default or rest. */
function boundNames(pattern: unknown): string[] {
	if (!isTreeNode(pattern)) return [];
	const name = identifierName(pattern);
	if (name !== undefined) return [name];
	switch (pattern.type) {
		case "AssignmentPattern":
			return boundNames(pattern.left);
		case "RestElement":
			return boundNames(pattern.argument);
		case "TSParameterProperty":
			return boundNames(pattern.parameter);
		case "ArrayPattern":
			return (Array.isArray(pattern.elements) ? pattern.elements : []).flatMap(
				boundNames,
			);
		case "ObjectPattern":
			return (
				Array.isArray(pattern.properties) ? pattern.properties : []
			).flatMap((property) =>
				isTreeNode(property) && property.type === "Property"
					? boundNames(property.value)
					: boundNames(property),
			);
		default:
			return [];
	}
}

/** A statement, or the declaration an `export` statement holds. */
function exported(statement: unknown): TreeNode | undefined {
	if (!isTreeNode(statement)) return undefined;
	return statement.type === "ExportNamedDeclaration" ||
		statement.type === "ExportDefaultDeclaration"
		? child(statement, "declaration")
		: statement;
}

function numberOf(node: TreeNode, field: string): number | undefined {
	const value = node[field];
	return typeof value === "number" ? value : undefined;
}
