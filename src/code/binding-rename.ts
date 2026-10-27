/**
 * Whether a binding named after a key can take the key's new name where it is, by the scopes of the
 * file's code, as a rename that renames the key renames the binding too: nothing nearer that is
 * declared by the new name takes over one of its references, nothing in the same scope declares it
 * already, and no other read of the new name inside its scope would read it instead.
 */

import { written } from "./candidates.ts";
import type { Binding, Span } from "./facts.ts";
import { fileSpan } from "./facts.ts";
import { readCode } from "./read.ts";
import { Scopes } from "./scopes.ts";
import { textOffset } from "./source.ts";

/** A place the new name is already taken, and why the rename would change what code there reads. */
export type Conflict = { at: Span; why: "declared" | "captured" };

/** Where a binding taking the name `to` would change what the code reads, in the file's text. */
export async function bindingConflicts(
	path: string,
	text: string,
	binding: Binding,
	to: string,
): Promise<Conflict[]> {
	// A file that never writes the new name as a whole name, plainly or with escapes, declares and
	// reads nothing by it, so its scopes need no reading. A longer name that holds it is another.
	const whole = new RegExp(`(?<![\\w$])${written(to)}(?![\\w$])`);
	if (!whole.test(unescaped(text))) return [];
	const modules = await readCode(path, text);
	if (!Array.isArray(modules)) return [];
	for (const { program, source } of modules) {
		const declared = textOffset(source, binding.at.start);
		if (declared === undefined) continue;
		const scopes = new Scopes(program);
		const own = scopes.resolve(binding.name, declared);
		if (own === undefined || own.node.start !== declared) continue;
		const conflicts = new Map<number, Conflict>();
		const inside = (scope: Span) =>
			own.scope.start <= scope.start && scope.end <= own.scope.end;
		const places = [
			declared,
			...binding.references.flatMap(
				({ at }) => textOffset(source, at.start) ?? [],
			),
		];
		for (const at of places) {
			const other = scopes.resolve(to, at);
			if (other !== undefined && inside(other.scope)) {
				const at = fileSpan(source, other.node);
				conflicts.set(at.start, { at, why: "declared" });
			}
		}
		for (const use of scopes.usesNamed(to)) {
			if (use.start < own.scope.start || use.start >= own.scope.end) continue;
			const other = scopes.resolve(to, use.start);
			if (other === undefined || !inside(other.scope)) {
				const at = fileSpan(source, use);
				conflicts.set(at.start, { at, why: "captured" });
			}
		}
		return [...conflicts.values()];
	}
	return [];
}

/**
 * A text with each `\u` escape written as the character it stands for, as an identifier may spell
 * a name with them; one that stands for no character stays as it is.
 */
function unescaped(text: string): string {
	if (!text.includes("\\u")) return text;
	return text.replace(
		/\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/g,
		(sequence, braced: string | undefined, plain: string | undefined) => {
			const point = Number.parseInt(braced ?? plain ?? "", 16);
			return point <= 0x10ffff ? String.fromCodePoint(point) : sequence;
		},
	);
}
