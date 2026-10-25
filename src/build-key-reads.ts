/**
 * The places a build's modules name a key no catalog has, read exactly: each module's code as the
 * last plugins see it, its imports followed to keys.js by the bundler's resolution, as grai/svelte
 * follows them, and its namespace read by scope, so a parameter or a variable of the same name is
 * not grai's. A module's place is where its source writes the name.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { type ESTree, parseSync } from "vite";
import type { Build } from "./compile.ts";
import { GraiError } from "./error.ts";
import { namespaceReads } from "./namespace-reads.ts";
import {
	type ImportedName,
	importedName,
	type Modules,
} from "./output-names.ts";
import { positionOf } from "./sources.ts";
import { isTreeNode } from "./svelte-tree.ts";

/** What the check follows a build's imports with: its names to keys.js, and the bundler's resolution. */
export type KeyReading = {
	build: Build;
	names: ImportedName;
	resolve: (source: string, importer: string) => Promise<string | undefined>;
};

/** A follower of a build's imports, which takes any name keys.js exports as a key, to check it. */
export function keyReading(
	build: Build,
	keysFile: string,
	resolve: KeyReading["resolve"],
): KeyReading {
	return { build, names: importedName(keysFile, () => true), resolve };
}

/** An error for each key a module's code names that no catalog has. */
export async function missingKeyReads(
	code: string,
	id: string,
	{ build, names, resolve }: KeyReading,
): Promise<GraiError[]> {
	const { program } = parseSync(id, code, { lang: "js" });
	const modules: Modules = { resolve, code: async (file) => sourceOf(file) };
	const keys = new Set(
		build.catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const namespaces = new Set<string>();
	const missing: { key: string; written: string }[] = [];
	for (const statement of importsOf(program)) {
		for (const { local, imported } of statement.names) {
			const name = await names(statement.source, id, imported, modules);
			if (name?.kind === "namespace") namespaces.add(local);
			else if (name?.kind === "key" && !keys.has(name.key))
				missing.push({ key: name.key, written: statement.written(name.key) });
		}
	}
	const reads = isTreeNode(program) ? namespaceReads(program, namespaces) : [];
	for (const read of reads) {
		if (!keys.has(read.key))
			missing.push({
				key: read.key,
				written: code.slice(read.start, read.end),
			});
	}
	return located(missing, id, build);
}

type ImportStatement = {
	source: string;
	names: { local: string; imported: string }[];
	/** How the source writes the import of a key: its per-key path, or the key's own name. */
	written: (key: string) => string;
};

/** The module's static imports of values, each with the names it binds and what it imports by them. */
function importsOf(program: ESTree.Program): ImportStatement[] {
	return program.body.flatMap((statement): ImportStatement[] => {
		if (
			statement.type !== "ImportDeclaration" ||
			statement.importKind === "type"
		)
			return [];
		const source = statement.source.value;
		const names = statement.specifiers.map((specifier) => ({
			local: specifier.local.name,
			imported:
				specifier.type === "ImportNamespaceSpecifier"
					? "*"
					: specifier.type === "ImportDefaultSpecifier"
						? "default"
						: exportName(specifier.imported),
		}));
		return [
			{
				source,
				names,
				written: (key) => (source.includes(key) ? source : key),
			},
		];
	});
}

function exportName(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}

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
