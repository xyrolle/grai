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

/** The directory a page's message chunks go to, and the one of each locale's copies. */
export const messageDirectory = "grai";
export const localeDirectory = (locale: string): string => `grai-${locale}`;

/** Whether a module holds one key's message, as a function or as the page's string. */
export function isMessageModule(id: string): boolean {
	return id.startsWith(keyModulePrefix) || id.startsWith(textModulePrefix);
}

/** Whether a chunk holds message modules and nothing else. */
export function messageOnly(moduleIds: readonly string[]): boolean {
	return moduleIds.length > 0 && moduleIds.every(isMessageModule);
}

/**
 * A file put in a sibling of its directory: `_app/immutable/chunks/a.js` with `grai` is
 * `_app/immutable/grai/a.js`. A sibling, so that a file's relative imports work alike from every
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
 * for the page's locale. Imports, exports and every name stay as rendered.
 */
export function localeCopies(
	fileName: string,
	code: string,
	locales: readonly string[],
): Map<string, string> {
	const calls = parseSync(fileName, code).program.body.flatMap((statement) =>
		statement.type === "VariableDeclaration"
			? statement.declarations.flatMap((declarator) =>
					declarator.init?.type === "CallExpression" ? [declarator.init] : [],
				)
			: [],
	);
	const source = (node: Spanned) => code.slice(node.start, node.end);
	const only = (variants: readonly (Spanned | null)[], index: number) =>
		[
			...Array.from({ length: index }, () => "void 0"),
			source(variantAt(variants, index, fileName)),
		].join(", ");
	const copies = new Map<string, string>();
	locales.forEach((locale, index) => {
		let copy = code;
		for (const call of calls.toReversed()) {
			const [first, second] = call.arguments;
			const replaced =
				call.arguments.length === 2 &&
				first?.type === "ArrayExpression" &&
				second?.type === "ArrayExpression"
					? `[${only(first.elements, index)}], [${only(second.elements, index)}]`
					: only(call.arguments, index);
			const start = call.arguments[0]?.start ?? call.end - 1;
			const end = call.arguments.at(-1)?.end ?? call.end - 1;
			copy = copy.slice(0, start) + replaced + copy.slice(end);
		}
		copies.set(locale, copy);
	});
	return copies;
}

function variantAt(
	variants: readonly (Spanned | null)[],
	index: number,
	fileName: string,
): Spanned {
	const variant = variants[index];
	if (variant === undefined || variant === null) {
		throw new Error(
			`grai: ${fileName} holds a message without a variant for every locale, so it cannot copy it per locale.`,
		);
	}
	return variant;
}
