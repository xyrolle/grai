import type { ESTree } from "vite";
import { childrenOf, type Node, type Span } from "./syntax.ts";

/** A name a module declares: the identifier that declares it, and the code it is visible in. */
export type Binding = { name: string; node: Node; scope: Span };

/** A use of a name: an identifier that reads or writes it, or a JSX element's name. */
export type Use = Extract<Node, { type: "Identifier" | "JSXIdentifier" }>;

/** The scopes a walk is in: the function's, where `var` declares, and the block's, where the rest do. */
type Enclosing = { fn: Span; block: Span };

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
};

/**
 * The names a module declares and where each is used, scope by scope, as JavaScript resolves them:
 * a use reads the declaration of the innermost scope around it that declares its name.
 */
export class Scopes {
	private readonly parents = new Map<Node, Node>();
	private readonly declared = new Map<string, Binding[]>();
	private readonly bindings = new Map<Node, Binding>();
	private readonly uses = new Map<string, Use[]>();
	/** The uses that assign their name a value: `x = …`, `x++`, `[x] = …`, `for (x of …)`. */
	private readonly writes = new Set<Node>();

	constructor(program: ESTree.Program) {
		const module = { start: program.start, end: program.end };
		this.visitChildren(program, { fn: module, block: module });
	}

	/** The node that holds a node. */
	parent(node: Node): Node | undefined {
		return this.parents.get(node);
	}

	/** The binding an identifier declares. */
	bindingOf(node: Node): Binding | undefined {
		return this.bindings.get(node);
	}

	/** The binding a name reads at an offset, or undefined when the module declares none there. */
	resolve(name: string, at: number): Binding | undefined {
		let innermost: Binding | undefined;
		for (const binding of this.declared.get(name) ?? []) {
			const { start, end } = binding.scope;
			const inside = start <= at && at < end;
			if (
				inside &&
				(innermost === undefined || end - start < size(innermost))
			) {
				innermost = binding;
			}
		}
		return innermost;
	}

	/** Whether anything assigns a binding again after it is declared. */
	isAssignedAgain(binding: Binding): boolean {
		return this.usesOf(binding).some((use) => this.writes.has(use));
	}

	/** Every use that reads a binding, in source order. */
	usesOf(binding: Binding): Use[] {
		return (this.uses.get(binding.name) ?? []).filter(
			(use) => this.resolve(binding.name, use.start) === binding,
		);
	}

	private visit(node: Node, at: Enclosing): void {
		const target = assignedIn(node);
		if (target !== undefined) this.markWritten(target);
		if (node.type === "Identifier") {
			this.addUse(node);
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
			node.type === "ArrowFunctionExpression"
		) {
			this.visitFunction(node, at);
		} else if (
			node.type === "ClassDeclaration" ||
			node.type === "ClassExpression"
		) {
			const scope = node.type === "ClassDeclaration" ? at.block : node;
			if (node.id !== null) this.addBinding(node.id, scope);
			this.visitChildren(node, at, "id");
		} else if (node.type === "CatchClause") {
			if (node.param !== null) this.declarePattern(node, node.param, node, at);
			this.visitChildren(node, { fn: at.fn, block: node }, "param");
		} else if (node.type === "StaticBlock") {
			// A class's static block keeps its vars, as a function's body does.
			this.visitChildren(node, { fn: node, block: node });
		} else if (blocks.has(node.type)) {
			this.visitChildren(node, { fn: at.fn, block: node });
		} else if (node.type !== "ExportNamedDeclaration" || node.source === null) {
			// A re-export, `export { a } from "…"`, names another module's bindings.
			this.visitChildren(node, at);
		}
	}

	private visitChildren(node: Node, at: Enclosing, skipped?: string): void {
		for (const [field, child] of childrenOf(node)) {
			this.parents.set(child, node);
			if (field === skipped || writesName(node, field)) continue;
			if (child.type === "JSXIdentifier") {
				if (namesElement(node, field)) this.addUse(child);
			} else {
				this.visit(child, at);
			}
		}
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
			const declared = node.type === "FunctionDeclaration";
			this.addBinding(node.id, declared ? at.block : node);
		}
		const parameters = { fn: node, block: node };
		for (const param of node.params) {
			this.declarePattern(node, param, node, parameters);
		}
		if (node.body !== null) {
			this.parents.set(node.body, node);
			this.visit(node.body, { fn: node.body, block: node.body });
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
	}

	/** Marks each name an assignment's target writes. */
	private markWritten(target: Node): void {
		if (target.type === "Identifier") {
			this.writes.add(target);
		} else if (target.type === "ObjectPattern") {
			for (const property of target.properties) {
				this.markWritten(
					property.type === "RestElement" ? property.argument : property.value,
				);
			}
		} else if (target.type === "ArrayPattern") {
			for (const element of target.elements) {
				if (element !== null) this.markWritten(element);
			}
		} else if (target.type === "AssignmentPattern") {
			this.markWritten(target.left);
		} else if (target.type === "RestElement") {
			this.markWritten(target.argument);
		} else if (
			target.type === "TSAsExpression" ||
			target.type === "TSSatisfiesExpression" ||
			target.type === "TSNonNullExpression" ||
			target.type === "TSTypeAssertion"
		) {
			this.markWritten(target.expression);
		}
	}

	private addBinding(node: Node & { name: string }, scope: Span): void {
		const binding = { name: node.name, node, scope };
		this.bindings.set(node, binding);
		appendTo(this.declared, node.name, binding);
	}

	private addUse(node: Use): void {
		appendTo(this.uses, node.name, node);
	}
}

/** The nodes that open a block's scope: what `let`, `const` and `class` declare in them stays in them. */
const blocks = new Set([
	"BlockStatement",
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
	"SwitchStatement",
]);

function appendTo<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values = map.get(key);
	if (values === undefined) map.set(key, [value]);
	else values.push(value);
}

/** What an assignment, an update or a `for … in`/`of` without a declaration writes to. */
function assignedIn(node: Node): Node | undefined {
	if (node.type === "AssignmentExpression") return node.left;
	if (node.type === "UpdateExpression") return node.argument;
	const loop = node.type === "ForInStatement" || node.type === "ForOfStatement";
	return loop && node.left.type !== "VariableDeclaration"
		? node.left
		: undefined;
}

function size({ scope }: Binding): number {
	return scope.end - scope.start;
}

/** Whether a node's field writes a name: a property's or a label's, not a use of a binding. */
function writesName(node: Node, field: string): boolean {
	const computed = "computed" in node && node.computed;
	return !computed && (nameFields[node.type]?.includes(field) ?? false);
}

/** Whether a JSX name in this field names a component, which is a use of its binding. */
function namesElement(node: Node, field: string): boolean {
	if (node.type === "JSXMemberExpression") return field === "object";
	const element =
		node.type === "JSXOpeningElement" || node.type === "JSXClosingElement";
	return element && field === "name";
}
