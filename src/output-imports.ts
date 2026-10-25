import type { CompiledKey } from "./compilation.ts";
import type { OutputModules } from "./output-modules.ts";

/**
 * The imports a module of keys needs from the output, each file named by `specifier`: the runtime
 * functions it names, the `unmatched` the keys' code throws with, the plural functions they count
 * with, and the formatters they call, each from its module among the output's `modules`.
 */
export function outputImports(
	specifier: (file: string) => string,
	modules: OutputModules,
	keys: Iterable<CompiledKey>,
	functions: Iterable<string>,
): string {
	const uses = new Set(functions);
	const plurals = new Set<string>();
	const formats = new Set<string>();
	for (const key of keys) {
		if (key.uses.has("unmatched")) uses.add("unmatched");
		for (const name of key.plurals) plurals.add(name);
		for (const name of key.formats.keys()) formats.add(name);
	}
	const from = (file: string) => JSON.stringify(specifier(file));
	const lines = [
		`import { ${[...uses].sort().join(", ")} } from ${from(modules.runtime)};`,
	];
	if (plurals.size > 0) {
		lines.push(
			`import { ${[...plurals].sort().join(", ")} } from ${from(modules.plurals)};`,
		);
	}
	if (formats.size > 0 && modules.formats !== undefined) {
		lines.push(
			`import { ${[...formats].sort().join(", ")} } from ${from(modules.formats)};`,
		);
	}
	return lines.join("\n");
}
