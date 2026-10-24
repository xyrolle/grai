import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import { pluralName } from "./plurals.ts";

/**
 * The imports a module of keys needs from the output: the runtime functions it names, the
 * `unmatched` the keys' code throws with, and the plural functions of the locales they count in.
 */
export function outputImports(
	outdir: string,
	keys: Iterable<CompiledKey>,
	functions: Iterable<string>,
): string {
	const uses = new Set(functions);
	const plurals = new Set<string>();
	for (const key of keys) {
		if (key.uses.has("unmatched")) uses.add("unmatched");
		for (const locale of key.plurals) plurals.add(pluralName(locale));
	}
	const from = (file: string) => JSON.stringify(join(outdir, file));
	const lines = [
		`import { ${[...uses].sort().join(", ")} } from ${from("runtime.js")};`,
	];
	if (plurals.size > 0) {
		lines.push(
			`import { ${[...plurals].sort().join(", ")} } from ${from("plurals.js")};`,
		);
	}
	return lines.join("\n");
}
