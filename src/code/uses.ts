/**
 * Each use of a value a module imports or loads, read from the module's scopes: the names read from
 * it in turn, and what then happens to what they read. A `const` that holds it is followed to its
 * own uses, as it is the same value; a copy into anything else is a use of it as a value.
 */

import {
	type Binding,
	originOf,
	type Span,
	type UseEnd,
	type UseFact,
	type Uses,
} from "./facts.ts";
import type { ESTree } from "./parse.ts";
import type { Scopes } from "./scopes.ts";
import { literalText, type Node } from "./syntax.ts";

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
	span: (node: Span) => Span,
): { uses: Uses; aliases: Record<string, string> } {
	const uses: Uses = {};
	const aliases: Record<string, string> = {};
	const add = (use: UseFact) => {
		const origin = originOf(use.from);
		const list = uses[origin];
		if (Array.isArray(list)) list.push(use);
		else uses[origin] = [use];
	};
	const follow = (
		node: Node,
		from: UseFact["from"],
		chain: UseFact["chain"],
		type: boolean,
	) => {
		const { end, alias, read } = endOf(node, chain, scopes, span);
		if (alias === undefined) {
			add({ from, at: span(node), type, chain: read, end });
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
		// An import type reads its qualifier's names from the module, for the types alone.
		if (node.type === "TSImportType") {
			follow(node, { load }, qualified(node, span), true);
		} else {
			follow(node, { load }, [], false);
		}
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
	span: (node: Span) => Span,
): { end: UseEnd; read: UseFact["chain"]; alias?: ESTree.BindingIdentifier } {
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
				return { end: pattern(id, scopes, span), read };
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
			return { end: pattern(parent.left, scopes, span), read };
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
function keySpan(node: Node): Span {
	return node.type === "Identifier"
		? node
		: { start: node.start + 1, end: node.end - 1 };
}

/**
 * A read by a computed name: the names it may be, those that start with its literal start (a
 * template's text before its first value, or text joined to one), or the literals of a choice.
 */
function computed(property: Node): {
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
function pattern(
	node: ESTree.ObjectPattern | ESTree.ObjectAssignmentTarget,
	scopes: Scopes,
	span: (node: Span) => Span,
): UseEnd {
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
			binds: boundBy(property.value, scopes, span),
		});
	}
	return { kind: "pattern", names, rest };
}

/** The name a pattern's value binds, with every reference to it. */
function boundBy(
	value: Node,
	scopes: Scopes,
	span: (node: Span) => Span,
): Binding | undefined {
	const target = value.type === "AssignmentPattern" ? value.left : value;
	if (target.type !== "Identifier") return undefined;
	const binding = scopes.bindingOf(target);
	if (binding === undefined) return undefined;
	return {
		name: binding.name,
		at: span(target),
		references: scopes.usesOf(binding).map((use) => span(use)),
	};
}

/** The names an import type's qualifier reads from its module, `title` of `import("…").title`. */
function qualified(
	node: ESTree.TSImportType,
	span: (node: Span) => Span,
): UseFact["chain"] {
	const names: ESTree.IdentifierName[] = [];
	for (let name = node.qualifier; name !== null; ) {
		if (name.type === "TSQualifiedName") {
			names.unshift(name.right);
			name = name.left;
		} else {
			names.unshift(name);
			name = null;
		}
	}
	return names.map((name) => ({
		name: name.name,
		at: span(name),
		expression: span({ start: node.start, end: name.end }),
	}));
}
