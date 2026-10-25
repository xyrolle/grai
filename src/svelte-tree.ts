/**
 * A node of a component's tree as Svelte's parser gives it: Svelte's own nodes and its scripts'
 * and expressions' ESTree nodes alike. Its fields are read one at a time, through the functions
 * below, since one type cannot describe both kinds.
 */
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

/** Where a node is in the component's source. */
export type Span = { start: number; end: number };

/** A node's place in the source, which every node of a parsed component has. */
export function spanOf(node: unknown): Span | undefined {
	return isTreeNode(node) &&
		typeof node.start === "number" &&
		typeof node.end === "number"
		? { start: node.start, end: node.end }
		: undefined;
}

/** A node's field, if it holds a node. */
export function child(node: TreeNode, field: string): TreeNode | undefined {
	const value = node[field];
	return isTreeNode(value) ? value : undefined;
}

/** An identifier's name, or nothing for any other node. */
export function identifierName(node: TreeNode | undefined): string | undefined {
	return node?.type === "Identifier" && typeof node.name === "string"
		? node.name
		: undefined;
}

/** A node with its parent, as `walk` gives it. */
export type Visit = { node: TreeNode; parent: TreeNode | undefined };

/** Every node under the roots, the roots included, each with its parent. */
export function* walk(roots: readonly unknown[]): Generator<Visit> {
	const pending: Visit[] = roots
		.filter(isTreeNode)
		.map((node) => ({ node, parent: undefined }));
	for (let visit = pending.pop(); visit; visit = pending.pop()) {
		yield visit;
		for (const value of Object.values(visit.node)) {
			for (const item of Array.isArray(value) ? value : [value]) {
				if (isTreeNode(item)) pending.push({ node: item, parent: visit.node });
			}
		}
	}
}
