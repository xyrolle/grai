import type { CompiledKey } from "./compilation.ts";
import type { OutputModules } from "./output-modules.ts";

/**
 * The names a module of keys calls, by where each comes from: a file of the output, which the
 * module imports it from, or the global scope.
 */
export type CalledNames = {
	runtime: ReadonlySet<string>;
	plurals: ReadonlySet<string>;
	formats: ReadonlySet<string>;
	globals: ReadonlySet<string>;
};

/**
 * The names a module of keys calls: the runtime functions it names, `functions` or else each key's
 * own, the `unmatched` the keys' code throws with, the functions of plurals.js they count with,
 * the formatters and the globals they call. A key's code refers to nothing else.
 */
export function calledNames(
	keys: Iterable<CompiledKey>,
	functions?: Iterable<string>,
): CalledNames {
	const runtime = new Set(functions);
	const plurals = new Set<string>();
	const formats = new Set<string>();
	const globals = new Set<string>();
	for (const key of keys) {
		if (functions === undefined) for (const name of key.uses) runtime.add(name);
		else if (key.uses.has("unmatched")) runtime.add("unmatched");
		for (const name of key.plurals) plurals.add(name);
		for (const name of key.formats.keys()) formats.add(name);
		for (const name of key.globals) globals.add(name);
	}
	return { runtime, plurals, formats, globals };
}

/** Every name of `names`, wherever it comes from. */
export function everyName(names: CalledNames): Set<string> {
	return new Set([
		...names.runtime,
		...names.plurals,
		...names.formats,
		...names.globals,
	]);
}

/**
 * The imports of `names` from the output, each from its module among the output's `modules`,
 * named by `specifier`.
 */
export function outputImports(
	names: CalledNames,
	specifier: (file: string) => string,
	modules: OutputModules,
): string {
	const line = (imported: ReadonlySet<string>, file: string) =>
		`import { ${[...imported].sort().join(", ")} } from ${JSON.stringify(specifier(file))};`;
	const lines = [line(names.runtime, modules.runtime)];
	if (names.plurals.size > 0) lines.push(line(names.plurals, modules.plurals));
	if (names.formats.size > 0 && modules.formats !== undefined)
		lines.push(line(names.formats, modules.formats));
	return lines.join("\n");
}
