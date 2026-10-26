import type { ESTree } from "./parse.ts";
import { ScopeWalk } from "./scope-walk.ts";
import type { Node, Span } from "./syntax.ts";

/** A name a module declares: the identifier that declares it, and the code it is visible in. */
export type Binding = { name: string; node: Node; scope: Span };

/** A use of a name: an identifier that reads or writes it, or a JSX element's name. */
export type Use = Extract<Node, { type: "Identifier" | "JSXIdentifier" }>;

/**
 * The names a module declares and where each is used, scope by scope, as JavaScript resolves them:
 * a use reads the declaration of the innermost scope around it that declares its name.
 */
export class Scopes {
	private readonly walk: ScopeWalk;

	/** The scopes of a program, with `onNode` seeing every node in the same walk. */
	constructor(program: ESTree.Program, onNode?: (node: Node) => void) {
		this.walk = new ScopeWalk(program, onNode);
	}

	/** The node that holds a node. */
	parent(node: Node): Node | undefined {
		return this.walk.parents.get(node);
	}

	/** The binding an identifier declares. */
	bindingOf(node: Node): Binding | undefined {
		return this.walk.bindings.get(node);
	}

	/** The binding a name reads at an offset, or undefined when the module declares none there. */
	resolve(name: string, at: number): Binding | undefined {
		let innermost: Binding | undefined;
		for (const binding of this.walk.declared.get(name) ?? []) {
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

	/** Whether a use is in a type, so that it reads nothing when the code runs. */
	isTypeUse(use: Use): boolean {
		return this.walk.typeUses.has(use);
	}

	/** Whether anything assigns a binding again after it is declared. */
	isAssignedAgain(binding: Binding): boolean {
		return this.usesOf(binding).some((use) => this.walk.writes.has(use));
	}

	/** Every use of a name, whatever it reads, in source order. */
	usesNamed(name: string): readonly Use[] {
		return this.walk.uses.get(name) ?? [];
	}

	/** Every use that reads a binding, in source order. */
	usesOf(binding: Binding): Use[] {
		return (this.walk.uses.get(binding.name) ?? []).filter(
			(use) => this.resolve(binding.name, use.start) === binding,
		);
	}
}

function size({ scope }: Binding): number {
	return scope.end - scope.start;
}
