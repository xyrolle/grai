import { parseSync } from "vite";

/** How keys.js imports a key's module in a build, and that module's id. */
export const keyPrefix = "grai:key/";
export const keyModulePrefix: string = `\0${keyPrefix}`;

/**
 * How a client build's component imports a message without inputs as the page's string
 * (`grai/svelte`), and that string's module id.
 */
export const textPrefix = "grai:text/";
export const textModulePrefix: string = `\0${textPrefix}`;

/**
 * How a build's key and text modules import the output's runtime, plurals and formats: by a prefix
 * of grai's, not by the output's path, so that a module's code, by which the bundler weighs it, is
 * the same wherever the project lives.
 */
export const outputPrefix = "grai:output/";

/** Whether a module holds one key's message, as a function or as the page's string. */
export function isMessageModule(id: string): boolean {
	return id.startsWith(keyModulePrefix) || id.startsWith(textModulePrefix);
}

/**
 * Rolldown's own module of helpers, such as the one that makes the namespace object of a key a page
 * imports later. It holds no words, so a chunk of messages may hold it too.
 */
const bundlerHelpers = "\0rolldown/runtime.js";

/** Whether a chunk holds message modules and nothing else but the bundler's helpers. */
export function messageOnly(moduleIds: readonly string[]): boolean {
	return (
		moduleIds.some(isMessageModule) &&
		moduleIds.every((id) => isMessageModule(id) || id === bundlerHelpers)
	);
}

/**
 * A file put in a directory within its own: `_astro/a.js` with `grai` is `_astro/grai/a.js`.
 * Within it, so that a host serving the bundler's directory as immutable (Astro's `_astro/`,
 * Vite's `assets/`, Kit's `_app/immutable/chunks/`) serves the file so too.
 */
export function inDirectory(fileName: string, directory: string): string {
	const at = fileName.lastIndexOf("/") + 1;
	return `${fileName.slice(0, at)}${directory}/${fileName.slice(at)}`;
}

/**
 * A file put in a sibling of its directory: `_astro/grai/a.js` with `grai-de` is
 * `_astro/grai-de/a.js`. A sibling, so that a file's relative imports work alike from every
 * locale's copy.
 */
export function besideDirectory(fileName: string, directory: string): string {
	const file = fileName.slice(fileName.lastIndexOf("/") + 1);
	const parent = fileName.slice(0, fileName.lastIndexOf("/"));
	const above = parent.slice(0, parent.lastIndexOf("/") + 1);
	return `${above}${directory}/${file}`;
}

/** Anything the parser gives with its place in the code. */
type Spanned = { start: number; end: number };

/**
 * A message-only chunk's code, as rendered before minification, once per locale. Each key is a
 * call of the runtime with one variant per locale (`text(…)`, `message(…)`, or `markup([…], […])`);
 * each copy keeps only its locale's variant, at its locale's position, so the runtime picks it
 * for the page's locale. Imports, exports, every name, and any other code, such as a namespace
 * object the bundler makes, stay as rendered.
 */
export function localeCopies(
	fileName: string,
	code: string,
	locales: readonly string[],
): Map<string, string> {
	const calls = parseSync(fileName, code).program.body.flatMap((statement) =>
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
	const only = (variants: readonly Spanned[], index: number) =>
		[
			...Array.from({ length: index }, () => "void 0"),
			...variants.slice(index, index + 1).map(source),
		].join(", ");
	// One pass over the calls in order, joined once. Rebuilding the code at each call took 8.4 s for a
	// chunk of 13,000 keys, against 0.14 s.
	const copyIn = (index: number) => {
		const pieces: string[] = [];
		let from = 0;
		for (const { call, variants } of calls) {
			const start = call.arguments[0]?.start ?? call.end - 1;
			const kept = variants.map((group) => only(group, index));
			pieces.push(
				code.slice(from, start),
				variants.length === 2 ? `[${kept[0]}], [${kept[1]}]` : (kept[0] ?? ""),
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
