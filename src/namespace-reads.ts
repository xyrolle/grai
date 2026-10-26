/**
 * The keys a module reads through a namespace it imports, by scope: `m.key`, `m?.key`, `m["key"]`
 * and the keys a pattern takes apart, `const { key } = m`, where `m` is the import, not a parameter,
 * a variable, a function, a class or a caught error that a nearer scope declares by the same name.
 * Read from the module's ESTree program, its scopes by `code/scopes.ts`.
 */

import type { ESTree } from "./code/parse.ts";
import { Scopes } from "./code/scopes.ts";
import { childrenOf, type Node } from "./code/syntax.ts";

/** A key a namespace's member names: the key, and where the member and the key's name are. */
export type NamespaceRead = {
	key: string;
	start: number;
	end: number;
	keyStart: number;
};

/** An object pattern: a declaration's or a default's, or an assignment's target. */
type ObjectPattern = ESTree.ObjectPattern | ESTree.ObjectAssignmentTarget;

/** Fields that hold only types, which read no value. */
const typeFields: ReadonlySet<string> = new Set([
	"typeAnnotation",
	"returnType",
	"typeParameters",
	"typeArguments",
	"superTypeArguments",
	"implements",
]);

/**
 * Each read of a key through one of the namespaces the program imports by these names, and whether
 * it reads one by a computed name too, `m[name]`, which may be any key.
 */
export function namespaceReads(
	program: ESTree.Program,
	namespaces: ReadonlySet<string>,
): { reads: NamespaceRead[]; computed: boolean } {
	const scopes = new Scopes(program);
	const isNamespace = (node: Node | null) =>
		node?.type === "Identifier" &&
		namespaces.has(node.name) &&
		isImported(scopes, node);
	const reads: NamespaceRead[] = [];
	let computed = false;
	const visit = (node: Node) => {
		if (node.type === "MemberExpression" && isNamespace(node.object)) {
			const read = memberRead(node);
			if (read === "computed") computed = true;
			else if (read !== undefined) reads.push(read);
		}
		const taken = takenApart(node);
		if (taken !== undefined && isNamespace(taken.value)) {
			const read = patternReads(taken.pattern);
			if (read === "computed") computed = true;
			else reads.push(...read);
		}
		for (const [field, child] of childrenOf(node)) {
			if (!typeFields.has(field)) visit(child);
		}
	};
	visit(program);
	return { reads, computed };
}

/**
 * The names a program reads members of, `name.member`, `name[member]` or `const { member } =
 * name`, in any scope.
 */
export function memberObjects(program: ESTree.Program): Set<string> {
	const names = new Set<string>();
	const visit = (node: Node) => {
		const object =
			node.type === "MemberExpression" ? node.object : takenApart(node)?.value;
		if (object?.type === "Identifier") names.add(object.name);
		for (const [, child] of childrenOf(node)) visit(child);
	};
	visit(program);
	return names;
}

/** Whether a name is the module's import of it, not a nearer declaration of the same name. */
function isImported(
	scopes: Scopes,
	node: { name: string; start: number },
): boolean {
	const binding = scopes.resolve(node.name, node.start);
	const declaring =
		binding === undefined ? undefined : scopes.parent(binding.node);
	return (
		declaring?.type === "ImportSpecifier" ||
		declaring?.type === "ImportDefaultSpecifier" ||
		declaring?.type === "ImportNamespaceSpecifier"
	);
}

/**
 * The object pattern a node takes a value apart with, and the value: a declaration's, an
 * assignment's or a default's.
 */
function takenApart(
	node: Node,
): { pattern: ObjectPattern; value: Node } | undefined {
	if (node.type === "VariableDeclarator" && node.init !== null) {
		return node.id.type === "ObjectPattern"
			? { pattern: node.id, value: node.init }
			: undefined;
	}
	if (
		node.type === "AssignmentExpression" ||
		node.type === "AssignmentPattern"
	) {
		return node.left.type === "ObjectPattern"
			? { pattern: node.left, value: node.right }
			: undefined;
	}
	return undefined;
}

/**
 * The keys an object pattern takes apart from the namespace, `const { key } = m` or
 * `const { "key": name } = m`, or `"computed"` when it takes one by a computed name or takes the
 * rest, which may be any key.
 */
function patternReads(pattern: ObjectPattern): NamespaceRead[] | "computed" {
	const reads: NamespaceRead[] = [];
	for (const property of pattern.properties) {
		if (property.type === "RestElement") return "computed";
		const { key } = property;
		if (key.type === "Literal" && typeof key.value === "string") {
			const { start, end } = key;
			reads.push({ key: key.value, start, end, keyStart: start + 1 });
		} else if (!property.computed && key.type === "Identifier") {
			const { start, end } = key;
			reads.push({ key: key.name, start, end, keyStart: start });
		} else {
			return "computed";
		}
	}
	return reads;
}

/**
 * The key a member of the namespace names, if it is one, or `"computed"` for a member by any other
 * computed name.
 */
function memberRead(
	node: ESTree.MemberExpression,
): NamespaceRead | "computed" | undefined {
	const { start, end, property } = node;
	if (!node.computed) {
		return property.type === "Identifier"
			? { key: property.name, start, end, keyStart: property.start }
			: undefined;
	}
	return property.type === "Literal" && typeof property.value === "string"
		? { key: property.value, start, end, keyStart: property.start + 1 }
		: "computed";
}
