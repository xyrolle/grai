import type { ESTree } from "../code/parse.ts";
import type { Binding, Scopes, Use } from "../code/scopes.ts";
import type { Node } from "../code/syntax.ts";
import { covers, type Edit, importWithout } from "./edits.ts";
import type { LibraryModule, Role } from "./library.ts";

/** An import of a library's name: the role the library gives it, or none for its own API. */
export type LibraryImport = {
	declaration: ESTree.ImportDeclaration;
	specifier: ESTree.ImportDeclarationSpecifier;
	binding: Binding;
	library: string;
	role: Role | undefined;
};

/** A use of a library's import that stays once the edits are made. */
export type StayingUse = { use: Use; library: string };

/** Each import of a name from a library's modules, with its role; a type's is none. */
export function libraryImports(
	program: ESTree.Program,
	scopes: Scopes,
	libraries: Readonly<Record<string, LibraryModule>>,
): LibraryImport[] {
	return program.body.flatMap((declaration) => {
		if (declaration.type !== "ImportDeclaration") return [];
		const module = ownEntry(libraries, declaration.source.value);
		if (module === undefined) return [];
		return declaration.specifiers.flatMap((specifier) => {
			const binding = scopes.bindingOf(specifier.local);
			if (binding === undefined) return [];
			const typeOnly =
				declaration.importKind === "type" ||
				(specifier.type === "ImportSpecifier" &&
					specifier.importKind === "type");
			const role = typeOnly
				? undefined
				: ownEntry(module.roles, importedName(specifier));
			const { library } = module;
			return [{ declaration, specifier, binding, library, role }];
		});
	});
}

/**
 * The edits that drop each import nothing uses once the other edits are made, and the uses that
 * stay of the imports that stay.
 */
export function unusedImports(
	imports: readonly LibraryImport[],
	edits: readonly Edit[],
	{ text, scopes }: { text: string; scopes: Scopes },
): { edits: Edit[]; staying: StayingUse[] } {
	const removed = new Set<Node>();
	const staying: StayingUse[] = [];
	for (const { specifier, binding, library } of imports) {
		const stays = scopes
			.usesOf(binding)
			.filter((use) => !edits.some((edit) => covers(edit, use)));
		if (stays.length === 0) removed.add(specifier);
		staying.push(...stays.map((use) => ({ use, library })));
	}
	const declarations = new Set(
		imports
			.filter(({ specifier }) => removed.has(specifier))
			.map(({ declaration }) => declaration),
	);
	const dropped = [...declarations].map((declaration) =>
		importWithout(text, declaration, removed),
	);
	return { edits: dropped, staying };
}

/**
 * How a migrated module imports grai's messages as `m`: `import { m } from "<path>"`, the namespace
 * messages.js exports, or with `namespace`, `import * as m from "<path>"`, keys.js's own.
 */
export type MessagesImport = { path: string; namespace: boolean };

/** The module's own import of `m` from grai's messages, a value its rewrites call. */
export function messagesImport(
	program: ESTree.Program,
	scopes: Scopes,
	messages: MessagesImport,
): Binding | undefined {
	const name = messages.namespace ? "*" : "m";
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration") continue;
		for (const specifier of statement.specifiers) {
			const binding = scopes.bindingOf(specifier.local);
			const imported = binding && valueImportOf(binding, scopes);
			const own =
				imported?.module === messages.path &&
				imported.name === name &&
				specifier.local.name === "m";
			if (own) return binding;
		}
	}
	return undefined;
}

/** The module a binding is imported from as a value, and the name it takes there. */
export function valueImportOf(
	binding: Binding,
	scopes: Scopes,
): { module: string; name: string } | undefined {
	const specifier = scopes.parent(binding.node);
	const declaration = specifier && scopes.parent(specifier);
	if (declaration?.type !== "ImportDeclaration") return undefined;
	const isSpecifier =
		specifier?.type === "ImportSpecifier" ||
		specifier?.type === "ImportDefaultSpecifier" ||
		specifier?.type === "ImportNamespaceSpecifier";
	if (!isSpecifier || declaration.importKind === "type") return undefined;
	if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") {
		return undefined;
	}
	return { module: declaration.source.value, name: importedName(specifier) };
}

/** The import of `m` from grai's messages, before the module's first import or its first statement. */
export function messagesInsertion(
	program: ESTree.Program,
	{ path, namespace }: MessagesImport,
): Edit {
	const first =
		program.body.find((statement) => statement.type === "ImportDeclaration") ??
		program.body.find(
			(statement) =>
				!(statement.type === "ExpressionStatement" && "directive" in statement),
		);
	const at = first?.start ?? program.end;
	const imported = namespace ? "* as m" : "{ m }";
	return { start: at, end: at, text: `import ${imported} from "${path}";\n` };
}

/** The name an import takes from its module: `default` for a default import, `*` for a namespace. */
function importedName(specifier: ESTree.ImportDeclarationSpecifier): string {
	if (specifier.type === "ImportDefaultSpecifier") return "default";
	if (specifier.type === "ImportNamespaceSpecifier") return "*";
	const { imported } = specifier;
	return imported.type === "Literal" ? imported.value : imported.name;
}

/** A record's own entry, never one its prototype has. */
function ownEntry<T>(
	record: Readonly<Record<string, T>>,
	key: string,
): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}
