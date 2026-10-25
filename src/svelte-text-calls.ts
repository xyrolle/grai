import type { AST } from "svelte/compiler";
import type { OutputName } from "./output-names.ts";
import {
	child,
	identifierName,
	spanOf,
	type TreeNode,
	walk,
} from "./svelte-tree.ts";

/**
 * A name a component's script imports: what it imports (`*` for a namespace) and from where, and
 * where that script's code starts, for an import of the same script to go.
 */
export type ComponentImport = {
	local: string;
	imported: string;
	source: string;
	scriptStart: number;
};

/** A name a component's script imports from grai's output, and where that script starts. */
export type OutputBinding = { name: OutputName; scriptStart: number };

/** A call of a text key with no arguments: its place in the source, its key and its script's start. */
export type TextCall = {
	start: number;
	end: number;
	key: string;
	scriptStart: number;
};

/** The names a component's scripts import as values, types left out. */
export function componentImports(ast: AST.Root): ComponentImport[] {
	// A component without one of its scripts has the field undefined, though its type says null.
	const scripts = [ast.module, ast.instance].flatMap((script) =>
		script ? [script] : [],
	);
	return scripts.flatMap((script) => {
		const scriptStart = spanOf(script.content)?.start;
		if (scriptStart === undefined) return [];
		return script.content.body.flatMap((statement) => {
			if (statement.type !== "ImportDeclaration" || isTypeOnly(statement))
				return [];
			const source = statement.source.value;
			if (typeof source !== "string") return [];
			return statement.specifiers
				.filter((specifier) => !isTypeOnly(specifier))
				.map((specifier) => ({
					local: specifier.local.name,
					imported: importedName(specifier),
					source,
					scriptStart,
				}));
		});
	});
}

type Specifier = Extract<
	AST.Script["content"]["body"][number],
	{ type: "ImportDeclaration" }
>["specifiers"][number];

/** The name an import specifier takes from its module: `*` for its namespace. */
function importedName(specifier: Specifier): string {
	if (specifier.type === "ImportNamespaceSpecifier") return "*";
	if (specifier.type === "ImportDefaultSpecifier") return "default";
	return specifier.imported.type === "Identifier"
		? specifier.imported.name
		: String(specifier.imported.value);
}

/** Whether TypeScript's `import type` or `{ type x }` imports it, so it names no value. */
function isTypeOnly(node: object): boolean {
	return "importKind" in node && node.importKind === "type";
}

/** The names a component calls with no arguments, as `name()` or `name.key()`: those an import may bind to grai's output. */
export function calledNames(ast: AST.Root): Set<string> {
	const names = new Set<string>();
	const roots = [ast.module, ast.instance, ast.fragment];
	for (const { node } of walk(roots)) {
		const callee = withoutArguments(node);
		const name = identifierName(
			callee?.type === "MemberExpression" ? child(callee, "object") : callee,
		);
		if (name !== undefined) names.add(name);
	}
	return names;
}

/** The names a component imports from grai's output, by the name each binds. */
export type OutputBindings = ReadonlyMap<string, OutputBinding>;

/**
 * Every call of a text key with no arguments, through the names the component imports from grai's
 * output. Nothing when another declaration in the component takes one of those names, as a
 * `{#each}` item or a function's parameter would: such a component is left as it is.
 */
export function textCalls(
	ast: AST.Root,
	bindings: OutputBindings,
	isText: (key: string) => boolean,
): TextCall[] | undefined {
	const calls = new Map<number, TextCall>();
	const roots = [ast.module, ast.instance, ast.fragment];
	for (const { node, parent } of walk(roots)) {
		if (declaresByName(node, bindings)) return undefined;
		const binding = bindingOf(node, bindings);
		if (binding !== undefined && !readsImport(node, parent, binding.name))
			return undefined;
		const call = textCall(node, bindings, isText);
		if (call !== undefined) calls.set(call.start, call);
	}
	return [...calls.values()];
}

/** A call's callee when it passes no arguments, or nothing for any other node. */
function withoutArguments(node: TreeNode): TreeNode | undefined {
	return node.type === "CallExpression" &&
		node.optional !== true &&
		Array.isArray(node.arguments) &&
		node.arguments.length === 0
		? child(node, "callee")
		: undefined;
}

/** The binding an identifier names, or nothing for any other node. */
function bindingOf(
	node: TreeNode | undefined,
	bindings: OutputBindings,
): OutputBinding | undefined {
	const name = identifierName(node);
	return name === undefined ? undefined : bindings.get(name);
}

function textCall(
	node: TreeNode,
	bindings: OutputBindings,
	isText: (key: string) => boolean,
): TextCall | undefined {
	const callee = withoutArguments(node);
	const span = spanOf(node);
	if (callee === undefined || span === undefined) return undefined;
	const member = callee.type === "MemberExpression" ? callee : undefined;
	if (member?.computed || member?.optional === true) return undefined;
	const binding = bindingOf(
		member ? child(member, "object") : callee,
		bindings,
	);
	const key = binding && calledKey(member, binding);
	if (binding === undefined || key === undefined || !isText(key))
		return undefined;
	return { ...span, key, scriptStart: binding.scriptStart };
}

/** The key a call names through its binding: the namespace's `m.key`, or a key's own name. */
function calledKey(
	member: TreeNode | undefined,
	binding: OutputBinding,
): string | undefined {
	if (binding.name.kind === "key")
		return member === undefined ? binding.name.key : undefined;
	return member && identifierName(child(member, "property"));
}

/** Whether a block names one of the bindings by a string, not an identifier: `{#each xs as x, m}`, `let:m`. */
function declaresByName(node: TreeNode, bindings: OutputBindings): boolean {
	const declared =
		node.type === "EachBlock"
			? node.index
			: node.type === "LetDirective"
				? node.name
				: undefined;
	return typeof declared === "string" && bindings.has(declared);
}

/**
 * Whether an identifier with a binding's name reads that import: the namespace as `m.key` or
 * `m[key]`, a key as its call, or the import itself. A property's name (`a.m`, `{ m: 1 }`) is no
 * reference. Anything else may be another declaration of the name.
 */
function readsImport(
	node: TreeNode,
	parent: TreeNode | undefined,
	name: OutputName,
): boolean {
	if (parent === undefined) return false;
	const isField = (field: string) => parent[field] === node;
	if (parent.type === "MemberExpression")
		return isField("object")
			? name.kind === "namespace"
			: isField("property") && !parent.computed;
	if (parent.type === "Property")
		return isField("key") && !parent.computed && !parent.shorthand;
	if (parent.type === "CallExpression")
		return name.kind === "key" && isField("callee");
	return importSpecifiers.has(parent.type);
}

const importSpecifiers: ReadonlySet<string> = new Set([
	"ImportSpecifier",
	"ImportDefaultSpecifier",
	"ImportNamespaceSpecifier",
]);
