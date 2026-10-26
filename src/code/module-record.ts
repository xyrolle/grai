/**
 * A module's record of what it imports and exports, as its statements write it: each import's path
 * and the names it takes, each re-export's names, and each name the module exports.
 */

import type { ExportFact, ImportFact, Span } from "./facts.ts";
import type { ESTree } from "./parse.ts";
import { declaredValues } from "./runtime-names.ts";

export function importFact(
	statement: ESTree.Statement | ESTree.Directive | ESTree.ModuleDeclaration,
	span: (node: Span) => Span,
	imports: ImportFact[],
): void {
	if (statement.type === "ImportDeclaration") {
		imports.push({
			source: statement.source.value,
			path: span(statement.source),
			names: statement.specifiers.map((specifier) => ({
				imported:
					specifier.type === "ImportNamespaceSpecifier"
						? "*"
						: specifier.type === "ImportDefaultSpecifier"
							? "default"
							: nameOf(specifier.imported),
				importedAt: span(
					specifier.type === "ImportSpecifier"
						? nameSpan(specifier.imported)
						: specifier.local,
				),
				local: specifier.local.name,
				at: span(specifier.local),
			})),
			reexports: [],
			typeOnly: statement.importKind === "type",
		});
	} else if (
		(statement.type === "ExportNamedDeclaration" &&
			statement.source !== null) ||
		statement.type === "ExportAllDeclaration"
	) {
		const source = statement.source;
		if (source === null) return;
		const specifiers =
			statement.type === "ExportNamedDeclaration" ? statement.specifiers : [];
		imports.push({
			source: source.value,
			path: span(source),
			names: [],
			reexports: specifiers.map((specifier) => ({
				imported: nameOf(specifier.local),
				importedAt: span(nameSpan(specifier.local)),
				exported: nameOf(specifier.exported),
				exportedAt: span(nameSpan(specifier.exported)),
			})),
			typeOnly: statement.exportKind === "type",
		});
	}
}

/**
 * What a statement exports at run time, `values` being the names the module declares as values: an
 * export of a type, a `declare` or a type-only import is erased with it (`runtime-names.ts`).
 */
export function exportFacts(
	statement: ESTree.Statement | ESTree.Directive | ESTree.ModuleDeclaration,
	values: ReadonlySet<string>,
	exports: ExportFact[],
): void {
	if (statement.type === "ExportAllDeclaration") {
		if (statement.exportKind === "type") return;
		exports.push({
			exported:
				statement.exported === null ? undefined : nameOf(statement.exported),
			source: statement.source.value,
			imported: "*",
		});
	} else if (statement.type === "ExportNamedDeclaration") {
		if (statement.exportKind === "type") return;
		for (const specifier of statement.specifiers) {
			if (specifier.exportKind === "type") continue;
			const exported = nameOf(specifier.exported);
			const local = nameOf(specifier.local);
			if (statement.source !== null) {
				exports.push({
					exported,
					source: statement.source.value,
					imported: local,
				});
			} else if (values.has(local)) {
				exports.push({ exported, local });
			}
		}
		if (statement.declaration !== null) {
			for (const name of declaredValues(statement.declaration))
				exports.push({ exported: name, local: name });
		}
	} else if (statement.type === "ExportDefaultDeclaration") {
		const declaration = statement.declaration;
		if (declaration.type === "Identifier" && values.has(declaration.name)) {
			exports.push({ exported: "default", local: declaration.name });
		}
	}
}

function nameOf(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}

/** Where a module's name for an export is: an identifier's, or a string's text inside its quotes. */
function nameSpan(name: ESTree.ModuleExportName): Span {
	return name.type === "Literal"
		? { start: name.start + 1, end: name.end - 1 }
		: name;
}
