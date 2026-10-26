/**
 * The walk the scope reader takes of a program, once: each node's parent, each name declared with
 * the code it is visible in, and each use of a name, with those that write it and those in a type.
 */

import { childFields, type ESTree } from "./parse.ts";
import {
	assignedIn,
	blocks,
	isType,
	namesElement,
	writesName,
	writtenNames,
} from "./scope-rules.ts";
import type { Binding, Use } from "./scopes.ts";
import { isNode, type Node, type Span } from "./syntax.ts";

/**
 * The scopes a walk is in: the function's, where `var` declares, and the block's, where the rest do;
 * and whether it is in a type, where a name reads only a type of its declaration.
 */
type Enclosing = { fn: Span; block: Span; type: boolean };

export class ScopeWalk {
	readonly parents: Map<Node, Node> = new Map();
	readonly declared: Map<string, Binding[]> = new Map();
	readonly bindings: Map<Node, Binding> = new Map();
	readonly uses: Map<string, Use[]> = new Map();
	/** The uses that assign their name a value: `x = …`, `x++`, `[x] = …`, `for (x of …)`. */
	readonly writes: Set<Node> = new Set();
	/** The uses in a type, `typeof x` or `x.Member` in an annotation, which read nothing at run time. */
	readonly typeUses: Set<Node> = new Set();
	/** What a reader also wants to see of every node, in the same walk. */
	private readonly onNode: ((node: Node) => void) | undefined;

	constructor(program: ESTree.Program, onNode?: (node: Node) => void) {
		this.onNode = onNode;
		const module = { start: program.start, end: program.end };
		this.visitChildren(program, { fn: module, block: module, type: false });
	}

	private visit(node: Node, at: Enclosing): void {
		this.onNode?.(node);
		const target = assignedIn(node);
		if (target !== undefined) {
			for (const name of writtenNames(target)) this.writes.add(name);
		}
		if (node.type === "Identifier") {
			this.addUse(node, at);
		} else if (node.type === "ImportDeclaration") {
			for (const specifier of node.specifiers) {
				this.parents.set(specifier, node);
				this.parents.set(specifier.local, specifier);
				this.addBinding(specifier.local, at.block);
			}
		} else if (node.type === "VariableDeclaration") {
			this.visitDeclaration(node, at);
		} else if (
			node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression" ||
			node.type === "ArrowFunctionExpression" ||
			node.type === "TSDeclareFunction" ||
			node.type === "TSEmptyBodyFunctionExpression"
		) {
			this.visitFunction(node, at);
		} else if (
			node.type === "TSEnumDeclaration" ||
			node.type === "TSImportEqualsDeclaration"
		) {
			this.addBinding(node.id, at.block);
			this.visitChildren(node, at, "id");
		} else if (node.type === "TSModuleDeclaration") {
			// `namespace N {}` declares N, and what its body declares stays in it.
			if (node.id.type === "Identifier") this.addBinding(node.id, at.block);
			this.visitChildren(node, { ...at, block: node }, "id");
		} else if (
			node.type === "ClassDeclaration" ||
			node.type === "ClassExpression"
		) {
			const scope = node.type === "ClassDeclaration" ? at.block : node;
			if (node.id !== null) this.addBinding(node.id, scope);
			this.visitChildren(node, at, "id");
		} else if (node.type === "CatchClause") {
			if (node.param !== null) this.declarePattern(node, node.param, node, at);
			this.visitChildren(node, { ...at, block: node }, "param");
		} else if (node.type === "StaticBlock") {
			// A class's static block keeps its vars, as a function's body does.
			this.visitChildren(node, { ...at, fn: node, block: node });
		} else if (blocks.has(node.type)) {
			this.visitChildren(node, { ...at, block: node });
		} else if (node.type !== "ExportNamedDeclaration" || node.source === null) {
			// A re-export, `export { a } from "…"`, names another module's bindings.
			this.visitChildren(node, at);
		}
	}

	private visitChildren(node: Node, at: Enclosing, skipped?: string): void {
		for (const field of childFields[node.type] ?? Object.keys(node)) {
			const value: unknown = Reflect.get(node, field);
			const named = field === skipped || writesName(node, field);
			if (Array.isArray(value)) {
				for (const item of value) {
					if (isNode(item)) this.visitChild(node, field, item, named, at);
				}
			} else if (isNode(value)) {
				this.visitChild(node, field, value, named, at);
			}
		}
	}

	private visitChild(
		node: Node,
		field: string,
		child: Node,
		named: boolean,
		at: Enclosing,
	): void {
		this.parents.set(child, node);
		if (named) return;
		if (child.type === "JSXIdentifier") {
			if (namesElement(node, field)) this.addUse(child, at);
			return;
		}
		const type = at.type || isType(child);
		this.visit(child, type === at.type ? at : { ...at, type });
	}

	/** `var` declares in the function's scope, the others in the block's. */
	private visitDeclaration(
		node: ESTree.VariableDeclaration,
		at: Enclosing,
	): void {
		const scope = node.kind === "var" ? at.fn : at.block;
		for (const declarator of node.declarations) {
			this.parents.set(declarator, node);
			this.declarePattern(declarator, declarator.id, scope, at);
			if (declarator.init !== null) {
				this.parents.set(declarator.init, declarator);
				this.visit(declarator.init, at);
			}
		}
	}

	/**
	 * A function's parameters are in a scope of its own, with an expression's own name; its body is
	 * another, where its `var`s are, which a parameter's default cannot see. A declaration's name is
	 * the enclosing block's.
	 */
	private visitFunction(
		node: ESTree.Function | ESTree.ArrowFunctionExpression,
		at: Enclosing,
	): void {
		if (node.id !== null) {
			const declared =
				node.type === "FunctionDeclaration" ||
				node.type === "TSDeclareFunction";
			this.addBinding(node.id, declared ? at.block : node);
		}
		const parameters = { fn: node, block: node, type: at.type };
		for (const param of node.params) {
			this.declarePattern(node, param, node, parameters);
		}
		for (const types of [node.typeParameters, node.returnType]) {
			if (types === null || types === undefined) continue;
			this.parents.set(types, node);
			this.visit(types, { ...parameters, type: true });
		}
		if (node.body !== null) {
			this.parents.set(node.body, node);
			this.visit(node.body, { ...at, fn: node.body, block: node.body });
		}
	}

	/** Declares each name a pattern binds; its defaults and computed keys are uses where it is. */
	private declarePattern(
		parent: Node,
		pattern: Node,
		scope: Span,
		at: Enclosing,
	): void {
		this.parents.set(pattern, parent);
		switch (pattern.type) {
			case "Identifier":
				this.addBinding(pattern, scope);
				break;
			case "ObjectPattern":
				for (const property of pattern.properties) {
					if (property.type === "RestElement") {
						this.declarePattern(pattern, property, scope, at);
					} else {
						this.parents.set(property, pattern);
						if (property.computed) this.visit(property.key, at);
						this.declarePattern(property, property.value, scope, at);
					}
				}
				break;
			case "ArrayPattern":
				for (const element of pattern.elements) {
					if (element !== null)
						this.declarePattern(pattern, element, scope, at);
				}
				break;
			case "AssignmentPattern":
				this.declarePattern(pattern, pattern.left, scope, at);
				this.parents.set(pattern.right, pattern);
				this.visit(pattern.right, at);
				break;
			case "RestElement":
				this.declarePattern(pattern, pattern.argument, scope, at);
				break;
			case "TSParameterProperty":
				this.declarePattern(pattern, pattern.parameter, scope, at);
				break;
			default:
				this.visit(pattern, at);
		}
		const annotation =
			pattern.type === "Identifier" ||
			pattern.type === "ObjectPattern" ||
			pattern.type === "ArrayPattern" ||
			pattern.type === "RestElement"
				? pattern.typeAnnotation
				: null;
		if (annotation !== null && annotation !== undefined) {
			this.parents.set(annotation, pattern);
			this.visit(annotation, { ...at, type: true });
		}
	}

	private addBinding(node: Node & { name: string }, scope: Span): void {
		const binding = { name: node.name, node, scope };
		this.bindings.set(node, binding);
		appendTo(this.declared, node.name, binding);
	}

	private addUse(node: Use, at: Enclosing): void {
		appendTo(this.uses, node.name, node);
		if (at.type) this.typeUses.add(node);
	}
}

function appendTo<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values = map.get(key);
	if (values === undefined) map.set(key, [value]);
	else values.push(value);
}
