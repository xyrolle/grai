import { parse } from "./code/parse.ts";

/** Anything the parser gives with its place in the code. */
type Spanned = { start: number; end: number };

/**
 * A message-only chunk's code, as rendered before minification, once per locale. Each key is a
 * call of the runtime with one variant per locale (`text(…)`, `message(…)`, or `markup([…], […])`);
 * each copy keeps only its locale's variant, which the runtime reads as the page's: a list
 * shorter than the locales holds the page's variant alone. Imports, exports, every name, and any
 * other code, such as a namespace object the bundler makes, stay as rendered.
 */
export function localeCopies(
	fileName: string,
	code: string,
	locales: readonly string[],
): Map<string, string> {
	const calls = parse(fileName, code).program.body.flatMap((statement) =>
		statement.type === "VariableDeclaration"
			? statement.declarations.flatMap(({ init }) => {
					if (init?.type !== "CallExpression") return [];
					const [first, second] = init.arguments;
					const lists =
						init.arguments.length === 2 &&
						first?.type === "ArrayExpression" &&
						second?.type === "ArrayExpression"
							? [first.elements, second.elements]
							: [init.arguments];
					const variants = variantsIn(lists, locales.length);
					return variants === undefined ? [] : [{ call: init, variants }];
				})
			: [],
	);
	const source = (node: Spanned) => code.slice(node.start, node.end);
	// One pass over the calls in order, joined once. Rebuilding the code at each call took 8.4 s for a
	// chunk of 13,000 keys, against 0.14 s.
	const copyIn = (index: number) => {
		const own = (list: readonly Spanned[]) =>
			list
				.slice(index, index + 1)
				.map(source)
				.join("");
		const pieces: string[] = [];
		let from = 0;
		for (const { call, variants } of calls) {
			// Markup's two lists stay arrays, of one variant each.
			const kept =
				variants.length === 1
					? variants.map(own)
					: variants.map((list) => `[${own(list)}]`);
			pieces.push(
				code.slice(from, call.arguments[0]?.start ?? call.end - 1),
				kept.join(", "),
			);
			from = call.arguments.at(-1)?.end ?? call.end - 1;
		}
		pieces.push(code.slice(from));
		return pieces.join("");
	};
	return new Map(locales.map((locale, index) => [locale, copyIn(index)]));
}

/** A node as the parser gives it, as much as telling a variant needs. */
type Node = Spanned & { type: string; value?: unknown };

/** The nodes of a key's locale functions, which a copy keeps. */
const functions = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

/** Whether a node is one locale's variant of a key: its text, or the function that makes it. */
const isVariant = (node: Node | null): node is Node =>
	node !== null &&
	(functions.has(node.type) ||
		node.type === "TemplateLiteral" ||
		(node.type === "Literal" && typeof node.value === "string"));

/**
 * A key's call's variants, in lists of one per locale: its arguments, or markup's two arrays. Nothing
 * for a call whose lists are not one variant per locale, which is no key's.
 */
function variantsIn(
	lists: readonly (readonly (Node | null)[])[],
	locales: number,
): Node[][] | undefined {
	const variants = lists.map((list) => list.filter(isVariant));
	return variants.every(
		(list, at) => list.length === locales && list.length === lists[at]?.length,
	)
		? variants
		: undefined;
}
