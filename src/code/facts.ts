/**
 * What a file's code does with what it imports, as plain data about that file alone: each module's
 * imports and exports, and each use of each name it imports. Which of those names are grai's is
 * not known here, as it takes other files to follow an import to grai's output (`modules.ts`); a
 * file's facts are therefore a function of its text, computed in workers and kept on disk by it.
 * Every offset is the file's.
 */

import { isLoad, loadFact } from "./loads.ts";
import type { ESTree } from "./parse.ts";
import { type CodeError, type ModuleCode, readCode } from "./read.ts";
import { Scopes } from "./scopes.ts";
import { fileOffset, type SourceCode } from "./source.ts";
import type { Node } from "./syntax.ts";
import { usesOf } from "./uses.ts";

/** A stretch of the file. */
export type Span = { start: number; end: number };

/**
 * Where a module gets a value: a static import's or a re-export's path, a dynamic import's or a
 * `require()`'s literal path, each with the names it takes. A namespace import takes `*`.
 */
export type ImportFact = {
	source: string;
	/** Where the path's text is, for a rename of a key's path. */
	path: Span;
	names: { imported: string; local: string; at: Span }[];
	typeOnly: boolean;
};

/**
 * What a module exports: a name for one of its own (a local name), or for another module's
 * (`export { a as b } from`, `export * as ns from`), or each name another module exports
 * (`export *`, with `exported` undefined).
 */
export type ExportFact =
	| { exported: string; local: string }
	| { exported: string | undefined; source: string; imported: string };

/**
 * A use of a value a module imports or loads: the import's local name, or the load's index; the
 * static names read from it in turn (`m.title` reads `title`, `i18n.m.title` reads `m` then
 * `title`), each where its name is and where the expression that reads it is; and what then
 * happens to what they read.
 */
export type UseFact = {
	from: { local: string } | { load: number };
	at: Span;
	type: boolean;
	chain: { name: string; at: Span; expression: Span }[];
	end: UseEnd;
};

/**
 * What a use ends in:
 * - `value`, a use of what it read as a value: called, passed, returned or shown;
 * - `computed`, a read by a name the code computes (the expression at `at`), which may be any of
 *   the names that start with `prefix`, or one of `choices` when it is a choice between literals;
 * - `pattern`, names taken apart from it (`const { a, "b": c } = m`), each with what it binds, and
 *   `rest`, where the pattern takes the rest or a name it computes, which may be any;
 * - `export`, an export of it, which `ExportFact` follows.
 */
export type UseEnd =
	| { kind: "value" }
	| {
			kind: "computed";
			at: Span;
			prefix: string;
			choices: string[] | undefined;
	  }
	| {
			kind: "pattern";
			names: { name: string; at: Span; binds: Binding | undefined }[];
			rest: Span | undefined;
	  }
	| { kind: "export" };

/** A name a pattern binds, with every reference to it, for a rename of a key's binding. */
export type Binding = { name: string; at: Span; references: Span[] };

/**
 * A dynamic import or `require()`, by a literal path (an `ImportFact` too) or by a template or a
 * glob, which loads the modules whose paths match `pattern`: literal text, and `*` for any text
 * without `/`. A load by anything else names no module, as the bundler leaves it to the runtime.
 */
export type LoadFact =
	| { at: Span; source: string }
	| { at: Span; pattern: string };

/**
 * A module's uses, by what each starts from (`originOf`). A list is facts, or the JSON the facts
 * cache kept it as, which `usesFrom` parses the first time a reading needs it: uses are most of a
 * module's facts, and most start from what holds none of grai's.
 */
export type Uses = Record<string, UseFact[] | string>;

/**
 * What a use starts from, as a module keeps its uses: an import's local name, or `#` and a load's
 * index.
 */
export function originOf(from: UseFact["from"]): string {
	return "local" in from ? from.local : `#${from.load}`;
}

/** The uses that start from an origin, parsed from what the cache kept the first time. */
export function usesFrom(uses: Uses, origin: string): readonly UseFact[] {
	const kept = uses[origin];
	if (kept === undefined) return [];
	if (typeof kept !== "string") return kept;
	const parsed: UseFact[] = JSON.parse(kept);
	uses[origin] = parsed;
	return parsed;
}

/** A module's facts. */
export type ModuleFacts = {
	imports: ImportFact[];
	exports: ExportFact[];
	loads: LoadFact[];
	uses: Uses;
	/** Each top-level `const` that holds an import (`const t = m`), by its name: the import's. */
	aliases: Record<string, string>;
};

/** A file's facts: its modules', or its error. */
export type FileFacts = { modules: ModuleFacts[] } | { error: CodeError };

/** A file's facts, from its path and text alone. */
export async function factsOf(path: string, text: string): Promise<FileFacts> {
	const modules = await readCode(path, text);
	if (!Array.isArray(modules)) return { error: modules };
	return { modules: modules.map(moduleFacts) };
}

function moduleFacts({ program, source }: ModuleCode): ModuleFacts {
	const loadNodes: Node[] = [];
	const scopes = new Scopes(program, (node) => {
		if (isLoad(node)) loadNodes.push(node);
	});
	const span = (node: Span): Span => fileSpan(source, node);
	const imports: ImportFact[] = [];
	const exports: ExportFact[] = [];
	const loads: LoadFact[] = [];
	for (const statement of program.body) {
		importFact(statement, span, imports);
		exportFacts(statement, exports);
	}
	// A use of a load names it by its index among the loads with facts: a load by a name loads
	// nothing the bundler follows, so it has none, and nor have its uses.
	const followed: Node[] = [];
	for (const node of loadNodes) {
		const fact = loadFact(node, span);
		if (fact === undefined) continue;
		loads.push(fact);
		followed.push(node);
		if ("source" in fact) {
			imports.push({
				source: fact.source,
				path: fact.at,
				names: [],
				typeOnly: false,
			});
		}
	}
	const { uses, aliases } = usesOf(program, scopes, followed, span);
	return { imports, exports, loads, uses, aliases };
}

/** The file's span of a node of the module's code. */
export function fileSpan(source: SourceCode, node: Span): Span {
	const start = fileOffset(source, node.start) ?? -1;
	const end = fileOffset(source, node.end) ?? start;
	return { start, end };
}

function importFact(
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
				local: specifier.local.name,
				at: span(specifier.local),
			})),
			typeOnly: statement.importKind === "type",
		});
	} else if (
		(statement.type === "ExportNamedDeclaration" &&
			statement.source !== null) ||
		statement.type === "ExportAllDeclaration"
	) {
		const source = statement.source;
		if (source === null) return;
		imports.push({
			source: source.value,
			path: span(source),
			names: [],
			typeOnly: statement.exportKind === "type",
		});
	}
}

function exportFacts(
	statement: ESTree.Statement | ESTree.Directive | ESTree.ModuleDeclaration,
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
			exports.push(
				statement.source === null
					? { exported, local }
					: { exported, source: statement.source.value, imported: local },
			);
		}
		const declaration = statement.declaration;
		if (declaration?.type === "VariableDeclaration") {
			for (const { id } of declaration.declarations) {
				if (id.type === "Identifier")
					exports.push({ exported: id.name, local: id.name });
			}
		}
	} else if (statement.type === "ExportDefaultDeclaration") {
		const declaration = statement.declaration;
		if (declaration.type === "Identifier") {
			exports.push({ exported: "default", local: declaration.name });
		}
	}
}

function nameOf(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}
