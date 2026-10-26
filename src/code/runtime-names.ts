/**
 * The names a module declares at run time, as the bundler runs TypeScript with its types erased: a
 * value import, a variable, a function, a class, an enum, a namespace that holds a value, and
 * `import x = require()`. A type, an interface, a `declare`, a type-only import and a namespace of
 * types alone are erased, so a module's export of one exports nothing, and its `export *` of the
 * same name is what an importer gets.
 */

import type { ESTree } from "./parse.ts";
import type { Node } from "./syntax.ts";

/** The names a module's top-level statements declare as values. */
export function runtimeNames(program: ESTree.Program): Set<string> {
	const names = new Set<string>();
	for (const statement of program.body) {
		if (statement.type === "ImportDeclaration") {
			if (statement.importKind === "type") continue;
			for (const specifier of statement.specifiers) {
				const typeOnly =
					specifier.type === "ImportSpecifier" &&
					specifier.importKind === "type";
				if (!typeOnly) names.add(specifier.local.name);
			}
			continue;
		}
		const declaration =
			statement.type === "ExportNamedDeclaration" ||
			statement.type === "ExportDefaultDeclaration"
				? statement.declaration
				: statement;
		if (declaration !== null) {
			for (const name of declaredValues(declaration)) names.add(name);
		}
	}
	return names;
}

/** The value names a declaration makes: none for a type, or anything `declare` writes. */
export function declaredValues(declaration: Node): string[] {
	if ("declare" in declaration && declaration.declare === true) return [];
	switch (declaration.type) {
		case "VariableDeclaration":
			return declaration.declarations.flatMap(({ id }) => patternNames(id));
		case "FunctionDeclaration":
		case "ClassDeclaration":
		case "TSEnumDeclaration":
			return declaration.id === null ? [] : [declaration.id.name];
		case "TSImportEqualsDeclaration":
			return declaration.importKind === "type" ? [] : [declaration.id.name];
		case "TSModuleDeclaration":
			return declaration.id.type === "Identifier" && holdsValue(declaration)
				? [declaration.id.name]
				: [];
		default:
			return [];
	}
}

/** Whether a namespace holds a value, which makes it one; a namespace of types alone is erased. */
function holdsValue({ body }: { body: ESTree.TSModuleBlock | null }): boolean {
	if (body === null) return false;
	return body.body.some((statement) => {
		const declaration =
			statement.type === "ExportNamedDeclaration"
				? statement.declaration
				: statement;
		if (declaration === null) return false;
		if (declaration.type === "TSModuleDeclaration")
			return holdsValue(declaration);
		return (
			declaredValues(declaration).length > 0 ||
			declaration.type === "ExpressionStatement"
		);
	});
}

/** The names a binding pattern declares. */
function patternNames(pattern: Node): string[] {
	switch (pattern.type) {
		case "Identifier":
			return [pattern.name];
		case "ObjectPattern":
			return pattern.properties.flatMap((property) =>
				patternNames(
					property.type === "RestElement" ? property.argument : property.value,
				),
			);
		case "ArrayPattern":
			return pattern.elements.flatMap((element) =>
				element === null ? [] : patternNames(element),
			);
		case "AssignmentPattern":
			return patternNames(pattern.left);
		case "RestElement":
			return patternNames(pattern.argument);
		default:
			return [];
	}
}
