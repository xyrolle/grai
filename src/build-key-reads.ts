/**
 * The places a build's modules name a key no catalog has, read exactly: each module's code as the
 * last plugins see it, its imports followed to keys.js by the bundler's resolution, as grai/svelte
 * follows them, and its namespace read by scope, so a parameter or a variable of the same name is
 * not grai's. A module's place is where its source writes the name.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { type ESTree, transformWithOxc } from "vite";
import type { Build } from "./compile.ts";
import { GraiError } from "./error.ts";
import { memberObjects, namespaceReads } from "./namespace-reads.ts";
import {
	type ImportedName,
	importedName,
	type Modules,
} from "./output-names.ts";
import { positionOf } from "./sources.ts";
import { isTreeNode } from "./svelte-tree.ts";

/** What the check follows a build's imports with: its names to keys.js, kept for the build. */
export type KeyReading = { build: Build; names: ImportedName };

/** A follower of a build's imports, which takes any name keys.js exports as a key, to check it. */
export function keyReading(build: Build, keysFile: string): KeyReading {
	return { build, names: importedName(keysFile, () => true) };
}

/** The bundler's resolution, from the module's own hook, as a plugin's context lasts no longer. */
export type Resolve = (
	source: string,
	importer: string,
) => Promise<string | undefined>;

/**
 * The keys a module's code reads through grai's namespace, whether it reads one by a computed name,
 * which may be any key, and an error for each key it names that no catalog has.
 */
export type KeyReads = {
	keys: ReadonlySet<string>;
	computed: boolean;
	missing: GraiError[];
};

/**
 * The keys a module's code, parsed as `program`, names through a namespace, and an error for each
 * that no catalog has. Only an import the module reads members of is followed, so a module's other
 * imports cost no resolving. A named import of a key keys.js lacks the bundler fails itself.
 */
export async function keyReads(
	program: ESTree.Program,
	code: string,
	id: string,
	{ build, names }: KeyReading,
	resolve: Resolve,
): Promise<KeyReads> {
	if (!isTreeNode(program))
		return { keys: new Set(), computed: false, missing: [] };
	const read = memberObjects(program);
	const modules: Modules = {
		// A build that ends before a module's check does drops its resolver: a name it can no
		// longer follow is taken for none of grai's, as one the check cannot tell never fails a build.
		resolve: (source, importer) =>
			resolve(source, importer).catch(() => undefined),
		code: codeAsRun,
	};
	const namespaces = new Set<string>();
	for (const statement of importsOf(program)) {
		for (const { local, imported } of statement.names) {
			if (!read.has(local)) continue;
			const name = await names(statement.source, id, imported, modules);
			if (name?.kind === "namespace") namespaces.add(local);
		}
	}
	const keys = new Set(
		build.catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const { reads, computed } = namespaceReads(program, namespaces);
	const missing = reads
		.filter(({ key }) => !keys.has(key))
		.map(({ key, start, end }) => ({ key, written: code.slice(start, end) }));
	return {
		keys: new Set(reads.flatMap(({ key }) => (keys.has(key) ? [key] : []))),
		computed,
		missing: located(missing, id, build),
	};
}

type ImportStatement = {
	source: string;
	names: { local: string; imported: string }[];
};

/** The module's static imports of values, each with the names it binds and what it imports by them. */
function importsOf(program: ESTree.Program): ImportStatement[] {
	return program.body.flatMap((statement): ImportStatement[] => {
		if (
			statement.type !== "ImportDeclaration" ||
			statement.importKind === "type"
		)
			return [];
		const names = statement.specifiers.map((specifier) => ({
			local: specifier.local.name,
			imported:
				specifier.type === "ImportNamespaceSpecifier"
					? "*"
					: specifier.type === "ImportDefaultSpecifier"
						? "default"
						: exportName(specifier.imported),
		}));
		return [{ source: statement.source.value, names }];
	});
}

function exportName(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}

/**
 * A module's code as the bundler runs it, read from its file: a TypeScript module's without its
 * types, which bind no value, so a type never stands for a name the module exports. Nothing for a
 * module that is not a file, or one that does not compile, which the bundler reports itself.
 */
async function codeAsRun(id: string): Promise<string | undefined> {
	const source = sourceOf(id);
	if (source === undefined || !typescript.test(id)) return source;
	return transformWithOxc(source, id, { sourcemap: false }).then(
		({ code }) => code,
		() => undefined,
	);
}

const typescript = /\.[cm]?tsx?$/;

/** A module's own source, read from its file, or nothing for one that is not a file. */
function sourceOf(id: string): string | undefined {
	if (id.startsWith("\0") || id.includes("?")) return undefined;
	try {
		return readFileSync(id, "utf8");
	} catch {
		return undefined;
	}
}

/** The errors, each placed where the module's source first writes it after the one before. */
function located(
	missing: readonly { key: string; written: string }[],
	id: string,
	build: Build,
): GraiError[] {
	const path = id.split("?")[0] ?? id;
	const source = sourceOf(path) ?? "";
	const file = relative(build.config.root, path);
	const from = new Map<string, number>();
	const texts = build.config.locales
		.map((locale) => `--${locale} "…"`)
		.join(" ");
	return missing.map(({ key, written }) => {
		const found = source.indexOf(written, from.get(written) ?? 0);
		from.set(written, found + written.length);
		const position =
			found === -1
				? undefined
				: positionOf(source, found + written.lastIndexOf(key));
		const place =
			position === undefined
				? file
				: `${file}:${position.line}:${position.column}`;
		return new GraiError(
			"key-missing",
			{ file: place, key },
			`${written} names a key no catalog has. Add it with grai add ${key} ${texts}, or fix the name.`,
		);
	});
}
