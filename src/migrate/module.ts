import type { ESTree } from "vite";
import type { Mapping } from "../import/mapping.ts";
import { applyEdits, covers } from "./edits.ts";
import {
	type LibraryImport,
	libraryImports,
	messagesImport,
	messagesInsertion,
	type StayingUse,
	unusedImports,
} from "./imports.ts";
import {
	type LibraryModule,
	type ModuleView,
	type Outcome,
	ownApi,
	type Translator,
} from "./library.ts";
import { type Binding, Scopes } from "./scopes.ts";
import { type Node, parseModule, type Span } from "./syntax.ts";
import {
	type Dependency,
	declarationEdits,
	dependencyEdits,
	dependencyList,
	doneTranslators,
} from "./translators.ts";

/** What modules are migrated with: the mapping, the modules of its library, its default namespace. */
export type Migration = {
	mapping: Mapping;
	libraries: Readonly<Record<string, LibraryModule>>;
	defaultNamespace: string;
};

/** A use left for a person: the offset a report names, and why. */
export type LeftUse = { at: number; detail: string };

/** A migrated module: its new text when it changed, how many calls it rewrote, and what it left. */
export type MigratedModule = {
	text: string | undefined;
	rewritten: number;
	left: LeftUse[];
};

/** A place the codemod looked at, the uses of names it covers, and what it becomes. */
type Result = {
	at: number;
	uses: readonly Node[];
	outcome: Outcome;
	translator?: Translator;
};

/**
 * Rewrites each call of a library's messages as a call of grai's, imports `m` from `messages`,
 * and removes the declarations and imports that leave unused. Every use it cannot rewrite stays,
 * with the declarations and imports it needs, and is reported.
 */
export function migrateModule(
	file: string,
	text: string,
	messages: string,
	migration: Migration,
): MigratedModule {
	const program = parseModule(file, text);
	if ("error" in program) {
		const left = [
			{ at: program.at, detail: `it cannot be parsed: ${program.error}` },
		];
		return { text: undefined, rewritten: 0, left };
	}
	const scopes = new Scopes(program);
	const module = { ...migration, text, scopes };
	const imports = libraryImports(program, scopes, migration.libraries);
	const { results, translators, dependencies } = resultsOf(imports, module);
	const messagesBinding = messagesImport(program, scopes);
	const settled = settle(results, scopes, messagesBinding);
	const rewrites = settled.flatMap(({ outcome }) =>
		"left" in outcome ? [] : [{ ...outcome.replace, text: outcome.text }],
	);
	const done = doneTranslators(translators, settled);
	const declarations = declarationEdits(translators, done, module);
	const edits = [
		...rewrites,
		...declarations.edits,
		...dependencyEdits(dependencies, done, text),
	];
	const unused = unusedImports(imports, edits, module);
	edits.push(...unused.edits);
	if (rewrites.length > 0 && messagesBinding === undefined) {
		edits.push(messagesInsertion(program, messages));
	}
	const left = [
		...settled.flatMap(({ at, outcome }) =>
			"left" in outcome ? [{ at, detail: outcome.left }] : [],
		),
		...ownUses(unused.staying, settled, declarations.kept),
	];
	return {
		text: edits.length === 0 ? undefined : applyEdits(text, edits),
		rewritten: rewrites.length,
		left: left.toSorted((a, b) => a.at - b.at),
	};
}

/**
 * The uses of the library's imports that stay and nothing reported yet, but those in a declaration
 * that stays for the uses left: each is the library's own API, for a person to replace.
 */
function ownUses(
	staying: readonly StayingUse[],
	settled: readonly Result[],
	kept: readonly Span[],
): LeftUse[] {
	const reported = new Set(settled.flatMap(({ uses }) => uses));
	return staying
		.filter(
			({ use }) =>
				!reported.has(use) && !kept.some((span) => covers(span, use)),
		)
		.map(({ use, library }) => ({
			at: use.start,
			detail: ownApi(use.name, library).left,
		}));
}

/**
 * What each use of a library's translators, hooks and components becomes, and each translator in a
 * list of React's hook dependencies, which goes once the translator's every call is rewritten.
 */
function resultsOf(
	imports: readonly LibraryImport[],
	module: ModuleView,
): {
	results: Result[];
	translators: Translator[];
	dependencies: Dependency[];
} {
	const results: Result[] = [];
	const translators: Translator[] = [];
	const dependencies: Dependency[] = [];
	for (const { binding, role } of imports) {
		if (role?.kind === "translator") {
			translators.push(role.translator(binding, module));
		} else if (role?.kind === "hook") {
			for (const use of module.scopes.usesOf(binding)) {
				const found = role.translators(use, module);
				if ("left" in found) {
					results.push({ at: use.start, uses: [use], outcome: found });
				} else {
					translators.push(...found);
				}
			}
		} else if (role?.kind === "component") {
			for (const element of elementsOf(binding, module)) {
				const outcome = role.element(element, module);
				const { closingElement } = element;
				const names = [element.openingElement.name, closingElement?.name];
				const uses = names.filter((name) => name !== undefined);
				results.push({ at: element.start, uses, outcome });
			}
		}
	}
	for (const translator of translators) {
		for (const use of module.scopes.usesOf(translator.binding)) {
			const list = dependencyList(use, module.scopes);
			if (list !== undefined) {
				dependencies.push({ translator, use, list });
				continue;
			}
			const outcome = translator.translate(use);
			results.push({ at: use.start, uses: [use], outcome, translator });
		}
	}
	return { results, translators, dependencies };
}

/** The elements a component's binding names: `<Name …>`, by the use in its opening tag. */
function elementsOf(
	binding: Binding,
	{ scopes }: ModuleView,
): ESTree.JSXElement[] {
	return scopes.usesOf(binding).flatMap((use) => {
		const opening = scopes.parent(use);
		const element = opening && scopes.parent(opening);
		const named =
			opening?.type === "JSXOpeningElement" && element?.type === "JSXElement";
		return named ? [element] : [];
	});
}

/**
 * The results, with a rewrite left where `m` names something else, or where it holds another
 * rewrite, which goes first: the next run rewrites the call around it.
 */
function settle(
	results: readonly Result[],
	scopes: Scopes,
	messages: Binding | undefined,
): Result[] {
	const replaced = results.flatMap(({ outcome }) =>
		"left" in outcome ? [] : [outcome.replace],
	);
	const leftFor = (result: Result, left: string) => ({
		...result,
		outcome: { left },
	});
	return results.map((result) => {
		const { outcome } = result;
		if ("left" in outcome) return result;
		const named = scopes.resolve("m", outcome.replace.start);
		if (named !== undefined && named !== messages) {
			return leftFor(
				result,
				"m names something else here: rename it, then run grai migrate again.",
			);
		}
		const holds = replaced.some(
			(inner) => inner !== outcome.replace && covers(outcome.replace, inner),
		);
		if (!holds) return result;
		return leftFor(
			result,
			"it holds another message call: run grai migrate again once that one is rewritten.",
		);
	});
}
