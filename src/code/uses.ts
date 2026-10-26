/**
 * Each use of a value a module imports or loads, read from the module's scopes: the names read from
 * it in turn, and what then happens to what they read. A `const` that holds it is followed to its
 * own uses, as it is the same value; a copy into anything else is a use of it as a value.
 */

import type { Reference, Span, UseEnd, UseFact } from "./facts.ts";
import type { ESTree } from "./parse.ts";
import type { Scopes } from "./scopes.ts";
import { literalText, type Node } from "./syntax.ts";
import { computed, pattern } from "./use-ends.ts";

/** Where a module's nodes are in its file, and how the file writes each use of a name. */
export type FileOf = {
	span: (node: Span) => Span;
	reference: (use: Node) => Reference;
};

/** Nodes that hold a value as it is: parentheses, TypeScript's assertions, `?.`'s chain. */
const transparent: ReadonlySet<string> = new Set([
	"ParenthesizedExpression",
	"TSAsExpression",
	"TSSatisfiesExpression",
	"TSNonNullExpression",
	"TSTypeAssertion",
	"ChainExpression",
]);

/** A module's uses of its imports and loads, and its top-level `const`s that hold an import. */
export function usesOf(
	program: ESTree.Program,
	scopes: Scopes,
	loads: readonly Node[],
	file: FileOf,
): { uses: UseFact[]; aliases: Record<string, string> } {
	const uses: UseFact[] = [];
	const aliases: Record<string, string> = {};
	const follow = (
		node: Node,
		from: UseFact["from"],
		chain: UseFact["chain"],
		type: boolean,
	) => {
		const { end, alias, read } = endOf(node, chain, scopes, file);
		if (alias === undefined) {
			uses.push({ from, ...file.reference(node), type, chain: read, end });
			return;
		}
		const binding = scopes.bindingOf(alias);
		if (binding === undefined) return;
		const topLevel =
			binding.scope.start === program.start &&
			binding.scope.end === program.end;
		if ("local" in from && topLevel) aliases[binding.name] = from.local;
		for (const use of scopes.usesOf(binding)) {
			follow(use, from, read, type || scopes.isTypeUse(use));
		}
	};
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration") continue;
		for (const specifier of statement.specifiers) {
			const binding = scopes.bindingOf(specifier.local);
			if (binding === undefined) continue;
			const from = { local: specifier.local.name };
			for (const use of scopes.usesOf(binding)) {
				follow(use, from, [], scopes.isTypeUse(use));
			}
		}
	}
	loads.forEach((node, load) => {
		follow(node, { load }, [], false);
	});
	return { uses, aliases };
}

/**
 * Where a use ends: the names read from it on the way, then what happens to what they read; or the
 * `const` it is held in, which `usesOf` follows.
 */
function endOf(
	start: Node,
	chain: UseFact["chain"],
	scopes: Scopes,
	file: FileOf,
): { end: UseEnd; read: UseFact["chain"]; alias?: ESTree.BindingIdentifier } {
	const { span } = file;
	const read = [...chain];
	let node = start;
	for (
		let parent = scopes.parent(node);
		parent !== undefined;
		parent = scopes.parent(node)
	) {
		if (transparent.has(parent.type) || parent.type === "AwaitExpression") {
			node = parent;
		} else if (parent.type === "MemberExpression" && parent.object === node) {
			const name = memberName(parent);
			if (name === undefined) {
				const end: UseEnd = {
					kind: "computed",
					at: span(parent),
					...computed(parent.property),
				};
				return { end, read };
			}
			read.push({
				name,
				at: span(keySpan(parent.property)),
				expression: span(parent),
			});
			node = parent;
		} else if (parent.type === "TSQualifiedName" && parent.left === node) {
			read.push({
				name: parent.right.name,
				at: span(parent.right),
				expression: span(parent),
			});
			node = parent;
		} else if (parent.type === "VariableDeclarator" && parent.init === node) {
			const { id } = parent;
			if (id.type === "ObjectPattern") {
				return { end: pattern(id, scopes, file), read };
			}
			const declaration = scopes.parent(parent);
			const constant =
				declaration?.type === "VariableDeclaration" &&
				declaration.kind === "const";
			if (id.type === "Identifier" && constant) {
				return { end: { kind: "value" }, read, alias: id };
			}
			return { end: { kind: "value" }, read };
		} else if (
			parent.type === "AssignmentExpression" &&
			parent.right === node &&
			parent.left.type === "ObjectPattern"
		) {
			return { end: pattern(parent.left, scopes, file), read };
		} else if (
			parent.type === "ExportSpecifier" ||
			(parent.type === "ExportDefaultDeclaration" &&
				parent.declaration === node)
		) {
			return { end: { kind: "export" }, read };
		} else {
			return { end: { kind: "value" }, read };
		}
	}
	return { end: { kind: "value" }, read };
}

/** The name a member reads, `.name`, `["name"]` or `` [`name`] ``, or undefined when computed. */
function memberName(member: ESTree.MemberExpression): string | undefined {
	if (!member.computed) {
		return member.property.type === "Identifier"
			? member.property.name
			: undefined;
	}
	return literalText(member.property);
}

/** Where a member's name is: an identifier's, or a string's text inside its quotes. */
export function keySpan(node: Node): Span {
	return node.type === "Identifier"
		? node
		: { start: node.start + 1, end: node.end - 1 };
}
