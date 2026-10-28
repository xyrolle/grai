import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ParseResult } from "oxc-parser";

/** This module's file, and grai's directory: `src` in grai's repository, `dist` as published. */
const self = fileURLToPath(import.meta.url);
const root = dirname(self);

/**
 * The compiler's identity: a hash of its modules (`compilerModules`), each by its path in grai's
 * directory and with its bytes as they are on disk, and of `copied`, the texts the output copies,
 * which are the runtime's modules and the templates of its declarations. A new version of grai
 * changes it, and so does a local change to any of them, which keeps the version. Where an import
 * is one the modules' finding cannot follow, it is the hash of every module of grai's, as no list
 * of them is then sure.
 */
export async function compilerIdentity(
	copied: readonly string[],
): Promise<string> {
	return identityOf((await compilerModules()) ?? everyModule(), copied);
}

/** The hash of modules by their paths and bytes, in the order of their paths, and of `copied`. */
function identityOf(
	modules: ReadonlyMap<string, Buffer>,
	copied: readonly string[],
): string {
	const digest = createHash("sha1");
	const ordered = [...modules].sort(([a], [b]) => (a < b ? -1 : 1));
	for (const [file, bytes] of ordered)
		digest.update(file).update("\0").update(bytes).update("\0");
	for (const text of copied) digest.update(text).update("\0");
	return digest.digest("hex");
}

/**
 * Every module of grai's directory, by its path in it, and the templates of its declarations,
 * when the compiler's own cannot be told apart.
 */
function everyModule(): Map<string, Buffer> {
	const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
		(file) =>
			(/\.(js|ts)$/.test(file) && !file.endsWith(".d.ts")) ||
			file.endsWith(".d.ts.template"),
	);
	return new Map(files.map((file) => [file, readFileSync(join(root, file))]));
}

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
	const unread = [join(root, `saved-build${extname(self)}`)];
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

/** Whether a file is in a directory, at any depth. */
function within(directory: string, file: string): boolean {
	const path = relative(directory, file);
	return (
		path !== "" &&
		path !== ".." &&
		!path.startsWith(`..${sep}`) &&
		!isAbsolute(path)
	);
}
