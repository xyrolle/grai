import type { ESTree } from "vite";
import { covers, type Edit, importWithout } from "./edits.ts";
import type { LibraryModule, Role } from "./library.ts";
import type { Binding, Scopes, Use } from "./scopes.ts";
import type { Node } from "./syntax.ts";

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

/** The module's own `import { m } from …`, which its rewrites call. */
export function messagesImport(
	program: ESTree.Program,
	scopes: Scopes,
): Binding | undefined {
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration") continue;
		for (const specifier of statement.specifiers) {
			const named =
				specifier.type === "ImportSpecifier" &&
				importedName(specifier) === "m" &&
				specifier.local.name === "m";
			if (named) return scopes.bindingOf(specifier.local);
		}
	}
	return undefined;
}

/** `import { m } from "<messages>"`, before the module's first import or its first statement. */
export function messagesInsertion(
	program: ESTree.Program,
	messages: string,
): Edit {
	const first =
		program.body.find((statement) => statement.type === "ImportDeclaration") ??
		program.body.find(
			(statement) =>
				!(statement.type === "ExpressionStatement" && "directive" in statement),
		);
	const at = first?.start ?? program.end;
	return { start: at, end: at, text: `import { m } from "${messages}";\n` };
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
