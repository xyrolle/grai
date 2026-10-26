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
 * `export * from …` and `export * as m from …`. A name a module exports itself, by a declaration
 * or a specifier, is that export's, never a star export's. The output's messages.js is one of
 * them: it is `export * as m from "./keys.js"`. A key's path resolves, in a build, to the key's
 * own module (`\0grai:key/title`), which exports that key alone. Each module is parsed once,
 * however many imports reach it.
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
		// A module's explicit exports, its declarations among them, come before its star exports,
		// wherever each is written: a name exported both ways is the explicit export's.
		for (const statement of body) {
			if (statement.type === "ExportNamedDeclaration") {
				if (
					statement.declaration &&
					declaredNames(statement.declaration).has(name)
				)
					return undefined;
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
			if (statement.type === "ExportDefaultDeclaration" && name === "default")
				return undefined;
			if (
				statement.type === "ExportAllDeclaration" &&
				statement.exported &&
				exportName(statement.exported) === name
			)
				return next(statement.source.value, "*");
		}
		for (const statement of body) {
			if (statement.type !== "ExportAllDeclaration" || statement.exported)
				continue;
			const found = await next(statement.source.value, name);
			if (found !== undefined) return found;
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

/** The names a declaration binds: a function's or class's, or each a variable's pattern takes. */
function declaredNames(declaration: ESTree.Declaration): Set<string> {
	if (declaration.type !== "VariableDeclaration")
		return new Set(
			"id" in declaration && declaration.id?.type === "Identifier"
				? [declaration.id.name]
				: [],
		);
	const names = new Set<string>();
	const bind = (
		pattern: ESTree.BindingPattern | ESTree.ParamPattern | null,
	) => {
		if (pattern === null) return;
		if (pattern.type === "Identifier") names.add(pattern.name);
		else if (pattern.type === "AssignmentPattern") bind(pattern.left);
		else if (pattern.type === "RestElement") bind(pattern.argument);
		else if (pattern.type === "ArrayPattern")
			for (const element of pattern.elements) bind(element);
		else if (pattern.type === "ObjectPattern")
			for (const property of pattern.properties)
				bind(property.type === "RestElement" ? property : property.value);
	};
	for (const declarator of declaration.declarations) bind(declarator.id);
	return names;
}

function exportName(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}
