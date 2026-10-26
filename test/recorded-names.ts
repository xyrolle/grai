import { parseSync } from "vite";
import type { CompiledKey } from "../src/compilation.ts";
import { calledNames, everyName } from "../src/output-imports.ts";

/**
 * The names an expression refers to and does not bind itself: each identifier but a property's
 * name, less the names its functions bind.
 */
function freeNames(code: string): Set<string> {
	const { program, errors } = parseSync("value.js", `(${code});`);
	if (errors.length > 0) throw new Error(errors[0]?.message);
	const bound = new Set<string>();
	const named = new Set<string>();
	const visit = (node: unknown, role: "reference" | "binding" | "name") => {
		if (Array.isArray(node)) {
			for (const each of node) visit(each, role);
			return;
		}
		if (typeof node !== "object" || node === null || !("type" in node)) return;
		if (node.type === "Identifier" && "name" in node) {
			const into = { reference: named, binding: bound, name: undefined }[role];
			into?.add(String(node.name));
			return;
		}
		const computed = "computed" in node && node.computed === true;
		for (const [field, child] of Object.entries(node)) {
			if (node.type === "MemberExpression" && field === "property" && !computed)
				visit(child, "name");
			else if (node.type === "Property" && field === "key" && !computed)
				visit(child, "name");
			else if (
				field === "params" ||
				(node.type === "VariableDeclarator" && field === "id")
			)
				visit(child, "binding");
			else visit(child, "reference");
		}
	};
	visit(program, "reference");
	return new Set([...named].filter((name) => !bound.has(name)));
}

/**
 * Each name a compiled key's code calls without recording it, as `key: name`: a module that binds a
 * key under that name would take it from the code that calls it.
 */
export function unrecordedCalls(
	keys: ReadonlyMap<string, CompiledKey>,
): string[] {
	const calls: string[] = [];
	for (const [key, compiled] of keys) {
		const recorded = everyName(calledNames([compiled], compiled.uses));
		for (const code of new Set([compiled.value, compiled.serverValue]))
			for (const name of freeNames(code))
				if (!recorded.has(name)) calls.push(`${key}: ${name}`);
	}
	return calls;
}
