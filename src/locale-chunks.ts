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

/** A span of the code that holds one variant per locale, and its copy for the locale at an index. */
type VariantSpan = Spanned & { copy: (index: number) => string };

/**
 * A message-only chunk's code, as rendered before minification, once per locale. Each key is a
 * call of the runtime with one variant per locale: as its strings (`text(…)`, `pageText(…)`), or
 * in each array it takes beside its own dispatch (`dispatcher(make, […])`). Each copy keeps only
 * its locale's variant, at its locale's position, so the runtime picks it for the page's locale.
 * Imports, exports and every name stay as rendered.
 */
export function localeCopies(
	fileName: string,
	code: string,
	locales: readonly string[],
): Map<string, string> {
	const source = (node: Spanned) => code.slice(node.start, node.end);
	const only = (variants: readonly (Spanned | null)[], index: number) =>
		[
			...Array.from({ length: index }, () => "void 0"),
			source(variantAt(variants, index, fileName)),
		].join(", ");
	/** Each span of the code that holds one variant per locale, with its copy for a locale. */
	const spans = parseSync(fileName, code).program.body.flatMap((statement) =>
		statement.type === "VariableDeclaration"
			? statement.declarations.flatMap(({ init }): VariantSpan[] => {
					if (init?.type !== "CallExpression") return [];
					// A call of strings, one per locale (`text`, `pageText`).
					if (init.arguments.every((argument) => argument.type === "Literal"))
						return [
							{
								start: init.arguments[0]?.start ?? init.end - 1,
								end: init.arguments.at(-1)?.end ?? init.end - 1,
								copy: (index) => only(init.arguments, index),
							},
						];
					// Any other call holds its variants in arrays, beside the dispatch that reads them
					// (`dispatcher(make, […])`).
					return init.arguments.flatMap((argument) =>
						argument.type === "ArrayExpression"
							? [
									{
										start: argument.start + 1,
										end: argument.end - 1,
										copy: (index: number) => only(argument.elements, index),
									},
								]
							: [],
					);
				})
			: [],
	);
	// One pass over the spans in order, joined once. Rebuilding the code at each call took 8.4 s for a
	// chunk of 13,000 keys, against 0.14 s.
	const copyIn = (index: number) => {
		const pieces: string[] = [];
		let from = 0;
		for (const span of spans) {
			pieces.push(code.slice(from, span.start), span.copy(index));
			from = span.end;
		}
		pieces.push(code.slice(from));
		return pieces.join("");
	};
	return new Map(locales.map((locale, index) => [locale, copyIn(index)]));
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
