import { type ESTree, parseSync } from "vite";
import { keyModulePrefix } from "./locale-chunks.ts";

/** What an import names in grai's output: the namespace of every key (`m`), or one key. */
export type OutputName = { kind: "namespace" } | { kind: "key"; key: string };

/** How names are followed from module to module: the bundler's resolution and its code. */
export type Modules = {
	/** The id `source` resolves to from `importer`, or nothing when it does not resolve. */
	resolve(source: string, importer: string): Promise<string | undefined>;
	/** A module's code, or nothing for a module that is not followed. */
	code(id: string): Promise<string | undefined>;
};

/** What `name` imported from `source` in `importer` is; `*` is the module's namespace. */
export type ImportedName = (
	source: string,
	importer: string,
	name: string,
	modules: Modules,
) => Promise<OutputName | undefined>;

/**
 * Follows an import to grai's keys.js the way the bundler binds it, through the modules that
 * re-export it: `export { m } from …`, an import exported again (`import { m } from …; export { m }`),
 * `export * from …` and `export * as m from …`. The output's messages.js is one of them: it is
 * `export * as m from "./keys.js"`. A key's path resolves, in a build, to the key's own module
 * (`\0grai:key/title`), which exports that key alone. Each module is parsed once, however many
 * imports reach it.
 */
export function importedName(
	keysFile: string,
	isKey: (name: string) => boolean,
): ImportedName {
	const programs = new Map<string, Promise<ESTree.Program | undefined>>();
	const program = (id: string, modules: Modules) => {
		const parsed =
			programs.get(id) ??
			modules
				.code(id)
				.then((code) =>
					code === undefined ? undefined : parseSync(id, code).program,
				);
		programs.set(id, parsed);
		return parsed;
	};

	const follow = async (
		source: string,
		importer: string,
		name: string,
		modules: Modules,
		seen: ReadonlySet<string>,
	): Promise<OutputName | undefined> => {
		const id = await modules.resolve(source, importer);
		if (id === undefined) return undefined;
		if (id === keysFile) {
			if (name === "*") return { kind: "namespace" };
			return isKey(name) ? { kind: "key", key: name } : undefined;
		}
		if (id.startsWith(keyModulePrefix)) {
			const key = id.slice(keyModulePrefix.length);
			return name === key && isKey(key) ? { kind: "key", key } : undefined;
		}
		const visit = `${id}\0${name}`;
		if (name === "*" || seen.has(visit)) return undefined;
		const body = (await program(id, modules))?.body ?? [];
		const next = (from: string, imported: string) =>
			follow(from, id, imported, modules, new Set(seen).add(visit));
		for (const statement of body) {
			if (statement.type === "ExportNamedDeclaration") {
				const specifier = statement.specifiers.find(
					(each) => exportName(each.exported) === name,
				);
				if (specifier === undefined) continue;
				const local = exportName(specifier.local);
				if (statement.source !== null)
					return next(statement.source.value, local);
				const imported = importOf(body, local);
				return imported && next(imported.source, imported.name);
			}
			if (statement.type === "ExportAllDeclaration") {
				const exported = statement.exported && exportName(statement.exported);
				if (exported === name) return next(statement.source.value, "*");
				if (exported !== null) continue;
				const found = await next(statement.source.value, name);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	};
	return (source, importer, name, modules) =>
		follow(source, importer, name, modules, new Set());
}

/** The import that binds `local` in a module, as its source and the name it imports. */
function importOf(
	body: readonly ESTree.Statement[],
	local: string,
): { source: string; name: string } | undefined {
	for (const statement of body) {
		if (statement.type !== "ImportDeclaration") continue;
		const specifier = statement.specifiers.find(
			(each) => each.local.name === local,
		);
		if (specifier === undefined) continue;
		const name =
			specifier.type === "ImportSpecifier"
				? exportName(specifier.imported)
				: specifier.type === "ImportNamespaceSpecifier"
					? "*"
					: "default";
		return { source: statement.source.value, name };
	}
	return undefined;
}

function exportName(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}
