import type { ESTree } from "vite";
import type { Mapping } from "../import/mapping.ts";
import { applyEdits, covers, declarationWithout, type Edit } from "./edits.ts";
import {
	type LibraryImport,
	libraryImports,
	messagesImport,
	messagesInsertion,
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
	const { results, translators } = resultsOf(imports, module);
	const settled = settle(results, scopes, messagesImport(program, scopes));
	const rewrites = settled.flatMap(({ outcome }) =>
		"left" in outcome ? [] : [{ ...outcome.replace, text: outcome.text }],
	);
	const declarations = declarationEdits(translators, settled, module);
	const edits = [...rewrites, ...declarations.edits];
	const unused = unusedImports(imports, edits, module);
	edits.push(...unused.edits);
	if (rewrites.length > 0 && messagesImport(program, scopes) === undefined) {
		edits.push(messagesInsertion(program, messages));
	}
	const reported = new Set(settled.flatMap(({ uses }) => uses));
	const own = unused.staying.filter(
		({ use }) =>
			!reported.has(use) &&
			!declarations.kept.some((span) => covers(span, use)),
	);
	const left = [
		...settled.flatMap(({ at, outcome }) =>
			"left" in outcome ? [{ at, detail: outcome.left }] : [],
		),
		...own.map(({ use, library }) => ({
			at: use.start,
			detail: ownApi(use.name, library).left,
		})),
	];
	return {
		text: edits.length === 0 ? undefined : applyEdits(text, edits),
		rewritten: rewrites.length,
		left: left.toSorted((a, b) => a.at - b.at),
	};
}

/** What each use of a library's translators, hooks and components becomes. */
function resultsOf(
	imports: readonly LibraryImport[],
	module: ModuleView,
): { results: Result[]; translators: Translator[] } {
	const results: Result[] = [];
	const translators: Translator[] = [];
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
			const outcome = translator.translate(use);
			results.push({ at: use.start, uses: [use], outcome, translator });
		}
	}
	return { results, translators };
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

/**
 * The edits that cut each translator whose every use is rewritten out of its declaration, and the
 * declarations that stay for the uses left, whose hook calls are then no use of their own. An
 * exported declaration stays as it is.
 */
function declarationEdits(
	translators: readonly Translator[],
	results: readonly Result[],
	{ text, scopes }: ModuleView,
): { edits: Edit[]; kept: Span[] } {
	const removed = new Set<Node>();
	const kept: Span[] = [];
	const declarators = new Set<ESTree.VariableDeclarator>();
	for (const translator of translators) {
		const { declarator } = translator;
		if (declarator === undefined) continue;
		const done = results.every(
			({ translator: of, outcome }) =>
				of !== translator || !("left" in outcome),
		);
		if (done) {
			removed.add(translator.binding.node);
			declarators.add(declarator);
		} else {
			kept.push(declarator);
		}
	}
	const edits = [...declarators].flatMap((declarator) => {
		const declaration = scopes.parent(declarator);
		const exported =
			declaration !== undefined &&
			scopes.parent(declaration)?.type === "ExportNamedDeclaration";
		const edit = exported
			? undefined
			: declarationWithout(text, declarator, declaration, removed);
		return edit === undefined ? [] : [edit];
	});
	return { edits, kept };
}
