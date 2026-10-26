import { type ESTree, parse } from "../code/parse.ts";

/** Any node of a module's syntax tree. */
export type Node = ESTree.Node;

/** A stretch of a module's text, by UTF-16 offsets as JavaScript strings count them. */
export type Span = { start: number; end: number };

/** A module's syntax tree, or the parser's first error, with where it is. */
export function parseModule(
	file: string,
	text: string,
): ESTree.Program | { error: string; at: number } {
	const { program, errors } = parse(file, text, { preserveParens: false });
	const [error] = errors;
	if (error === undefined) return program;
	return { error: error.message, at: error.labels[0]?.start ?? 0 };
}

/** Whether a value is a node: the tree's objects all have a `type`, its other fields are data. */
export function isNode(value: unknown): value is Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

/** Each node a node holds, with the field that holds it, in source order. */
export function* childrenOf(node: Node): Generator<[string, Node]> {
	const fields: [string, unknown][] = Object.entries(node);
	for (const [field, value] of fields) {
		if (Array.isArray(value)) {
			for (const item of value) if (isNode(item)) yield [field, item];
		} else if (isNode(value)) {
			yield [field, value];
		}
	}
}

/** The text of a string literal, or of a template literal without expressions; else undefined. */
export function literalText(node: Node | null | undefined): string | undefined {
	if (node?.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
		return node.quasis[0]?.value.cooked ?? undefined;
	}
	return undefined;
}

/** The name a property's key writes, as a name or a string, unless it is computed. */
export function keyName(property: ESTree.ObjectProperty): string | undefined {
	if (property.computed) return undefined;
	return property.key.type === "Identifier"
		? property.key.name
		: literalText(property.key);
}

/** An object's properties by the names their keys write, or undefined when one is not such a property. */
export function propertiesOf(
	object: ESTree.ObjectExpression,
): Map<string, ESTree.ObjectProperty> | undefined {
	const properties = new Map<string, ESTree.ObjectProperty>();
	for (const property of object.properties) {
		if (property.type !== "Property" || property.kind !== "init") {
			return undefined;
		}
		const name = keyName(property);
		if (name === undefined || property.method) return undefined;
		properties.set(name, property);
	}
	return properties;
}
