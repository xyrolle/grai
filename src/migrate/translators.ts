import type { ESTree } from "../code/parse.ts";
import { arrayWithout, declarationWithout, type Edit } from "./edits.ts";
import { valueImportOf } from "./imports.ts";
import type { Outcome, Translator } from "./library.ts";
import type { Scopes } from "./scopes.ts";
import type { Node, Span } from "./syntax.ts";

/** A use of a translator, and what it becomes. */
export type TranslatorUse = { translator?: Translator; outcome: Outcome };

/** A translator listed in the dependencies of React's hook, and the list. */
export type Dependency = {
	translator: Translator;
	use: Node;
	list: ESTree.ArrayExpression;
};

/** React's hooks whose last argument lists what they depend on. */
const dependencyHooks = new Set([
	"useMemo",
	"useCallback",
	"useEffect",
	"useLayoutEffect",
	"useInsertionEffect",
	"useImperativeHandle",
]);

/** The list a use is in when it is the dependencies of React's hook: `useMemo(…, [t])`. */
export function dependencyList(
	use: Node,
	scopes: Scopes,
): ESTree.ArrayExpression | undefined {
	const list = scopes.parent(use);
	const call = list && scopes.parent(list);
	if (list?.type !== "ArrayExpression" || call?.type !== "CallExpression") {
		return undefined;
	}
	const hook = reactExport(call.callee, scopes);
	const lists = hook !== undefined && dependencyHooks.has(hook);
	return lists && call.arguments.at(-1) === list ? list : undefined;
}

/** The name of React's export a callee is: `useMemo` imported from react, or `React.useMemo`. */
function reactExport(callee: Node, scopes: Scopes): string | undefined {
	const named = callee.type === "Identifier" ? callee : undefined;
	const member =
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.object.type === "Identifier" &&
		callee.property.type === "Identifier"
			? { object: callee.object, name: callee.property.name }
			: undefined;
	const local = named ?? member?.object;
	const binding = local && scopes.resolve(local.name, local.start);
	const imported = binding && valueImportOf(binding, scopes);
	if (imported?.module !== "react") return undefined;
	if (named !== undefined) return imported.name;
	const whole = imported.name === "default" || imported.name === "*";
	return whole ? member?.name : undefined;
}

/** The translators each use of which, but their hook dependencies, is rewritten. */
export function doneTranslators(
	translators: readonly Translator[],
	results: readonly TranslatorUse[],
): Set<Translator> {
	const unfinished = new Set(
		results.flatMap(({ translator, outcome }) =>
			translator !== undefined && "left" in outcome ? [translator] : [],
		),
	);
	return new Set(translators.filter((each) => !unfinished.has(each)));
}

/**
 * The edits that cut each translator that is done out of its declaration, and the declarations
 * that stay for the uses left, whose hook calls are then no use of their own. An exported
 * declaration stays as it is.
 */
export function declarationEdits(
	translators: readonly Translator[],
	done: ReadonlySet<Translator>,
	{ text, scopes }: { text: string; scopes: Scopes },
): { edits: Edit[]; kept: Span[] } {
	const removed = new Set<Node>();
	const kept: Span[] = [];
	const declarators = new Set<ESTree.VariableDeclarator>();
	for (const translator of translators) {
		const { declarator } = translator;
		if (declarator === undefined) continue;
		if (done.has(translator)) {
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

/** Each list of hook dependencies without the translators that are done. */
export function dependencyEdits(
	dependencies: readonly Dependency[],
	done: ReadonlySet<Translator>,
	text: string,
): Edit[] {
	const dropped = Map.groupBy(
		dependencies.filter(({ translator }) => done.has(translator)),
		({ list }) => list,
	);
	return [...dropped].map(([list, uses]) =>
		arrayWithout(text, list, new Set(uses.map(({ use }) => use))),
	);
}
