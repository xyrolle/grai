/**
 * What a file's code does with what it imports, as plain data about that file alone: each module's
 * imports and exports, and each use of each name it imports. Which of those names are grai's is
 * not known here, as it takes other files to follow an import to grai's output (`modules.ts`); a
 * file's facts are therefore a function of its text, computed in workers and kept on disk by it.
 * Every offset is the file's.
 */

import { moduleLinks } from "../module-links.ts";
import { isLoad, loadFact, loadsModule } from "./loads.ts";
import { exportFacts, importFact } from "./module-record.ts";
import { type CodeError, type ModuleCode, readCode } from "./read.ts";
import { runtimeNames } from "./runtime-names.ts";
import { Scopes } from "./scopes.ts";
import { fileOffset, type Shorthand, type SourceCode } from "./source.ts";
import type { Node } from "./syntax.ts";
import { callWithout, propertyShorthand } from "./use-ends.ts";
import { type FileOf, usesOf } from "./uses.ts";

/** A stretch of the file. */
export type Span = { start: number; end: number };

/**
 * Where a module gets a value: a static import's or a re-export's path, a dynamic import's or a
 * `require()`'s literal path, each with the names it takes, where the name it imports is and where
 * the binding it makes is, and the names a re-export passes on. A namespace import takes `*`.
 */
export type ImportFact = {
	source: string;
	/** Where the path's text is, for a rename of a key's path. */
	path: Span;
	names: { imported: string; importedAt: Span; local: string; at: Span }[];
	reexports: Reexport[];
	typeOnly: boolean;
};

/** A name a re-export passes on, `export { imported as exported } from`, and where each is. */
export type Reexport = {
	imported: string;
	importedAt: Span;
	exported: string;
	exportedAt: Span;
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
 * A use of a value a module imports or loads: the import's local name, or the load's index; where
 * the use is, and how the file writes it when in shorthand; the static names read from it in turn
 * (`m.title` reads `title`, `i18n.m.title` reads `m` then `title`), each where its name is and
 * where the expression that reads it is; and what then happens to what they read.
 */
export type UseFact = Reference & {
	from: { local: string } | { load: number };
	type: boolean;
	chain: { name: string; at: Span; expression: Span }[];
	end: UseEnd;
};

/**
 * What a use ends in:
 * - `value`, a use of what it read as a value: called, passed, returned or shown; `call` is the
 *   call of a name or a plain member read with no arguments (`m.title()`), which a text can replace;
 * - `computed`, a read by a name the code computes (the expression at `at`), which may be any of
 *   the names that start with `prefix`, or one of `choices` when it is a choice between literals;
 * - `pattern`, names taken apart from it (`const { a, "b": c } = m`), each with what it binds, and
 *   `rest`, where the pattern takes the rest or a name it computes, which may be any;
 * - `export`, an export of it, which `ExportFact` follows.
 */
export type UseEnd =
	| { kind: "value"; call: Span | undefined }
	| {
			kind: "computed";
			at: Span;
			prefix: string;
			choices: string[] | undefined;
	  }
	| {
			kind: "pattern";
			names: {
				name: string;
				at: Span;
				written: Span;
				binds: Binding | undefined;
			}[];
			rest: Span | undefined;
	  }
	| { kind: "export" };

/** A name an import or a pattern binds, with every reference to it, for a rename of the binding. */
export type Binding = { name: string; at: Span; references: Reference[] };

/**
 * A use of a name: where it is; when it is written in shorthand (`{ title }`, Svelte's `{title}`),
 * how to write it out in full around another name; and its call with no arguments, `title()`.
 */
export type Reference = {
	at: Span;
	shorthand: Shorthand | undefined;
	call: Span | undefined;
};

/**
 * A dynamic import or `require()`, by a literal path (an `ImportFact` too) or by a template, which
 * loads the modules whose paths match `pattern`: literal text, and `*` for any text without `/`; or
 * `import.meta.glob`, by its globs, a `!` before one leaving out what it matches. A load by anything
 * else names no module, as the bundler leaves it to the runtime.
 */
export type LoadFact =
	| { at: Span; source: string }
	| { at: Span; pattern: string }
	| { at: Span; globs: string[] };

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

/**
 * A table of a module's facts by name, without a prototype: a name is any identifier, so an
 * `Object.prototype` property's, `constructor` or `__proto__`, must be the table's own entry and
 * nothing it inherits. `entries` copies another's into it, as JSON gives back an object.
 */
export function table<T>(entries: Record<string, T> = {}): Record<string, T> {
	return Object.assign(Object.create(null), entries);
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
	/** Each top-level `const` that holds an import or a member of one, by its name (`aliasOf`). */
	aliases: Record<string, Alias>;
	/** Where in the file an import of the module's own may go, if it may take one. */
	importsAt: number | undefined;
	/**
	 * The directives the module opens with, as `"use client"`, which tells React where its code runs:
	 * Next reads it to put a module, and every module it imports, in the client's graphs.
	 */
	directives: string[];
	/**
	 * Whether the module's code is re-exports and nothing else, which a bundler sees through to the
	 * modules that hold the names an importer takes (`module-links.ts`).
	 */
	reexportsOnly: boolean;
};

/**
 * What a top-level `const` holds: an import, by its local name, or the members read from it on the
 * way, as `const m = messages.m` holds `messages`'s `m`.
 */
export type Alias = { local: string; members: string[] };

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
	const file: FileOf = {
		span,
		reference: (use) => {
			const at = span(use);
			const shorthand =
				source.shorthands.get(at.start) ?? propertyShorthand(use, scopes, at);
			const call = callWithout(use, scopes);
			return { at, shorthand, call: call && span(call) };
		},
	};
	const imports: ImportFact[] = [];
	const exports: ExportFact[] = [];
	const loads: LoadFact[] = [];
	const values = runtimeNames(program);
	for (const statement of program.body) {
		importFact(statement, span, imports);
		exportFacts(statement, values, exports);
	}
	// A use of a load names it by its index among the loads with facts: a load by a name loads
	// nothing the bundler follows, so it has none, and nor have its uses.
	const followed: Node[] = [];
	for (const node of loadNodes) {
		if (!loadsModule(node, scopes)) continue;
		const fact = loadFact(node, span);
		if (fact === undefined) continue;
		loads.push(fact);
		followed.push(node);
		if ("source" in fact) {
			imports.push({
				source: fact.source,
				path: fact.at,
				names: [],
				reexports: [],
				typeOnly: node.type === "TSImportType",
			});
		}
	}
	const { uses, aliases } = usesOf(program, scopes, followed, file);
	return {
		imports,
		exports,
		loads,
		uses,
		aliases,
		importsAt: source.importsAt,
		directives: directivesOf(program),
		reexportsOnly: moduleLinks(program).reexportsOnly,
	};
}

/** The directives that open a module's code: the leading statements that are each one. */
function directivesOf(program: { body: readonly Node[] }): string[] {
	const directives: string[] = [];
	for (const statement of program.body) {
		if (
			statement.type !== "ExpressionStatement" ||
			typeof statement.directive !== "string"
		)
			break;
		directives.push(statement.directive);
	}
	return directives;
}

/** The file's span of a node of the module's code. */
export function fileSpan(source: SourceCode, node: Span): Span {
	const start = fileOffset(source, node.start) ?? -1;
	const end = fileOffset(source, node.end) ?? start;
	return { start, end };
}
