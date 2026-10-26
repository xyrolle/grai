/**
 * The `paths` of a project's tsconfig, as specifiers the resolver maps (`mappings.ts`): those of the
 * root tsconfig, of every tsconfig it extends, and of every project it references and theirs. Each
 * target is an absolute path, from the `baseUrl` that applies to it or else from the tsconfig that
 * declares it. All of them are taken, a superset of what TypeScript's overriding keeps, which is
 * what a test of what a specifier may name needs.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "./parse.ts";
import type { Node } from "./syntax.ts";

/** A `paths` entry: its key, and its targets as absolute paths, `*` kept. */
export type PathsEntry = { key: string; targets: string[] };

/**
 * Every `paths` entry the tsconfig and those it extends or references declare, each target from
 * the declaring tsconfig's directory and from every `baseUrl` among them; or undefined when one of
 * them cannot be read, as nothing then says what a specifier may name.
 */
export function tsconfigPaths(file: string): PathsEntry[] | undefined {
	const declared: { key: string; targets: string[]; from: string }[] = [];
	const bases = new Set<string>();
	const read = new Set<string>();
	const visit = (config: string): boolean => {
		if (read.has(config)) return true;
		read.add(config);
		const value = jsonc(config);
		if (!isRecord(value)) return false;
		const directory = dirname(config);
		const options = isRecord(value.compilerOptions)
			? value.compilerOptions
			: {};
		if (typeof options.baseUrl === "string") {
			bases.add(resolve(directory, options.baseUrl));
		}
		if (isRecord(options.paths)) {
			for (const [key, targets] of Object.entries(options.paths)) {
				if (!Array.isArray(targets)) return false;
				const written = targets.filter((each) => typeof each === "string");
				declared.push({ key, targets: written, from: directory });
			}
		}
		for (const parent of [value.extends].flat()) {
			if (parent === undefined) continue;
			const found =
				typeof parent === "string" ? extended(config, parent) : undefined;
			if (found === undefined || !visit(found)) return false;
		}
		const references = Array.isArray(value.references) ? value.references : [];
		for (const reference of references) {
			const path = isRecord(reference) ? reference.path : undefined;
			if (typeof path !== "string") return false;
			const at = resolve(directory, path);
			const referenced = isDirectory(at) ? join(at, "tsconfig.json") : at;
			if (!isFile(referenced) || !visit(referenced)) return false;
		}
		return true;
	};
	if (!visit(file)) return undefined;
	return declared.map(({ key, targets, from }) => ({
		key,
		targets: [from, ...bases].flatMap((base) =>
			targets.map((target) => resolve(base, target)),
		),
	}));
}

/**
 * The tsconfig an `extends` names, as TypeScript finds it: a path from the tsconfig's directory,
 * with `.json` if it names none, or a package's in a `node_modules` above it, as the file it
 * names, that file with `.json`, or the package's `tsconfig.json`.
 */
function extended(config: string, name: string): string | undefined {
	if (name.startsWith(".") || isAbsolute(name)) {
		const path = resolve(dirname(config), name);
		return [path, `${path}.json`].find(isFile);
	}
	for (let directory = dirname(config); ; directory = dirname(directory)) {
		const path = join(directory, "node_modules", name);
		const found = [path, `${path}.json`, join(path, "tsconfig.json")].find(
			isFile,
		);
		if (found !== undefined) return found;
		if (dirname(directory) === directory) return undefined;
	}
}

/** JSON with comments and trailing commas, as a tsconfig is written; undefined if it does not parse. */
function jsonc(file: string): unknown {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	const { program, errors } = parse("tsconfig.js", `(${text}\n)`);
	const [statement] = program.body;
	if (errors.length > 0 || statement?.type !== "ExpressionStatement") {
		return undefined;
	}
	return jsonOf(statement.expression);
}

/** The value a JSON literal's tree writes, or undefined for anything else. */
function jsonOf(node: Node): unknown {
	switch (node.type) {
		case "ParenthesizedExpression":
			return jsonOf(node.expression);
		case "Literal":
			return node.value;
		case "ArrayExpression":
			return node.elements.map((element) =>
				element === null || element.type === "SpreadElement"
					? undefined
					: jsonOf(element),
			);
		case "ObjectExpression": {
			const object: Record<string, unknown> = {};
			for (const property of node.properties) {
				if (property.type !== "Property") continue;
				const key =
					property.key.type === "Literal"
						? String(property.key.value)
						: property.key.type === "Identifier"
							? property.key.name
							: undefined;
				if (key !== undefined) object[key] = jsonOf(property.value);
			}
			return object;
		}
		default:
			return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFile(path: string): boolean {
	return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isDirectory(path: string): boolean {
	return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}
