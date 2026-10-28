// The compiler's modules, as grai's build lists them in dist (`compilerModulesFile`): found by
// parsing them, which a start never does, as loading and running the parser costs it about 20 ms.

import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ParseResult } from "oxc-parser";
import { within } from "./compiler-identity.ts";

/** grai's directory: `src` in grai's repository, `dist` as published. */
const root = dirname(fileURLToPath(import.meta.url));

/**
 * The modules a compile runs and a saved build is read by, by their paths: saved-build's, which
 * imports the compiler's, and every module they import in turn, as oxc's parser reads them: an
 * `import` or `export … from` of a value, an import for a module's effects alone, and an `import()`
 * of a literal path. An import of types alone is left out, as Node and the build erase it, and so is
 * a module of Node's or of another package. Undefined when a module does not parse, imports a path
 * no literal gives, or imports one that is none of the files of grai's directory.
 */
export async function compilerModules(): Promise<
	Map<string, Buffer> | undefined
> {
	const { parse } = await import("./code/parse.ts");
	const modules = new Map<string, Buffer>();
	const unread = [
		join(root, `saved-build${extname(fileURLToPath(import.meta.url))}`),
	];
	for (let file = unread.pop(); file !== undefined; file = unread.pop()) {
		const path = relative(root, file);
		if (modules.has(path)) continue;
		const bytes = readFileSync(file);
		modules.set(path, bytes);
		const text = bytes.toString("utf8");
		const specifiers = importsOf(parse(file, text), text);
		if (specifiers === undefined) return undefined;
		for (const specifier of specifiers) {
			const imported = resolved(specifier, file);
			if (imported === undefined) return undefined;
			if (imported !== null) unread.push(imported);
		}
	}
	return modules;
}

/** A string literal's text, in any quotes, with no escape and nothing a template puts in. */
const literalPath = /^(["'`])([^"'`\\$\r\n]*)\1$/;

/** The paths a module imports at run time, or undefined if it does not parse or one is no literal. */
function importsOf(
	{ program, module, errors }: ParseResult,
	text: string,
): string[] | undefined {
	if (errors.length > 0) return undefined;
	const specifiers: string[] = [];
	for (const statement of program.body) {
		if (statement.type === "ImportDeclaration") {
			if (statement.importKind !== "type")
				specifiers.push(statement.source.value);
		} else if (
			(statement.type === "ExportNamedDeclaration" ||
				statement.type === "ExportAllDeclaration") &&
			statement.source !== null &&
			statement.exportKind !== "type"
		) {
			specifiers.push(statement.source.value);
		}
	}
	for (const { moduleRequest } of module.dynamicImports) {
		const literal = literalPath.exec(
			text.slice(moduleRequest.start, moduleRequest.end),
		);
		if (literal?.[2] === undefined) return undefined;
		specifiers.push(literal[2]);
	}
	return specifiers;
}

/**
 * The file of grai's directory an import names, as Node resolves it; null for a module of Node's
 * or of another package; undefined for any other, such as a file that is not there, or one of
 * grai's package outside its directory.
 */
function resolved(
	specifier: string,
	importer: string,
): string | null | undefined {
	if (isBuiltin(specifier)) return null;
	let url: URL;
	try {
		url = /^\.\.?\//.test(specifier)
			? new URL(specifier, pathToFileURL(importer))
			: new URL(import.meta.resolve(specifier));
	} catch {
		return undefined;
	}
	if (url.protocol !== "file:") return undefined;
	const file = fileURLToPath(url);
	if (within(root, file)) return existsSync(file) ? file : undefined;
	const packageDirectory = dirname(root);
	return within(packageDirectory, file) &&
		!within(join(packageDirectory, "node_modules"), file)
		? undefined
		: null;
}
