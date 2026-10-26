/**
 * Reading a tree a framework's parser gives as plain objects, which no type of grai's describes:
 * Astro's and MDX's. A node is an object with a `type`; its fields are read one at a time.
 */

/** A node of such a tree. */
export type TreeNode = {
	readonly type: string;
	readonly [field: string]: unknown;
};

export function isTreeNode(value: unknown): value is TreeNode {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

/** A node's field, if it holds a node. */
export function child(node: unknown, field: string): TreeNode | undefined {
	if (!isTreeNode(node)) return undefined;
	const value = node[field];
	return isTreeNode(value) ? value : undefined;
}

/** The nodes a node's field holds, as a list or one. */
export function children(node: TreeNode, field: string): TreeNode[] {
	const value = node[field];
	const values: unknown[] = Array.isArray(value) ? value : [value];
	return values.filter(isTreeNode);
}

/** A field of any object, such as a parser's error, or undefined. */
export function field(value: unknown, name: string): unknown {
	return typeof value === "object" && value !== null
		? Reflect.get(value, name)
		: undefined;
}

/** A node's text field, or undefined. */
export function text(node: TreeNode, field: string): string | undefined {
	const value = node[field];
	return typeof value === "string" ? value : undefined;
}

/** A node's number field, or undefined. */
export function number(node: unknown, field: string): number | undefined {
	if (!isTreeNode(node)) return undefined;
	const value = node[field];
	return typeof value === "number" ? value : undefined;
}

/** Each node a node holds, in any field, with the field. */
export function* fields(node: TreeNode): Generator<[string, TreeNode]> {
	for (const [field, value] of Object.entries(node)) {
		const values: unknown[] = Array.isArray(value) ? value : [value];
		for (const item of values) if (isTreeNode(item)) yield [field, item];
	}
}
