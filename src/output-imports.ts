import { join } from "node:path";
import type { CompiledKey } from "./compilation.ts";
import { pluralName } from "./plurals.ts";

/**
 * The imports a module of keys needs from the output: the runtime functions it names, the
 * `unmatched` the keys' code throws with, the plural functions of the locales they count in, and
 * the formatters they call.
 */
export function outputImports(
	outdir: string,
	keys: Iterable<CompiledKey>,
	functions: Iterable<string>,
): string {
	const uses = new Set(functions);
	const plurals = new Set<string>();
	const formats = new Set<string>();
	for (const key of keys) {
		if (key.uses.has("unmatched")) uses.add("unmatched");
		for (const locale of key.plurals)
			plurals.add(pluralName(locale, "cardinal"));
		for (const name of key.formats.keys()) formats.add(name);
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
	if (formats.size > 0) {
		lines.push(
			`import { ${[...formats].sort().join(", ")} } from ${from("formats.js")};`,
		);
	}
	return lines.join("\n");
}
