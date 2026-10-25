import type { ESTree } from "vite";
import type { Node, Span } from "./syntax.ts";

/** A change to a module's text: the span it replaces, and what it writes there. */
export type Edit = Span & { text: string };

/** The text with every edit made. Edits do not overlap; one that inserts goes before what is at its offset. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
	const lastFirst = edits.toSorted(
		(a, b) => b.start - a.start || b.end - a.end,
	);
	let edited = text;
	for (const { start, end, text: written } of lastFirst) {
		edited = edited.slice(0, start) + written + edited.slice(end);
	}
	return edited;
}

/** Whether an edit replaces the whole of a span. */
export function covers(edit: Span, span: Span): boolean {
	return edit.start <= span.start && span.end <= edit.end;
}

/** Deletes a span, and the line it is on when nothing else is on that line. */
export function deletion(text: string, { start, end }: Span): Edit {
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const newline = text.indexOf("\n", end);
	const lineEnd = newline === -1 ? text.length : newline;
	const alone =
		text.slice(lineStart, start).trim() === "" &&
		text.slice(end, lineEnd).trim() === "";
	if (!alone) return { start, end, text: "" };
	return {
		start: lineStart,
		end: Math.min(lineEnd + 1, text.length),
		text: "",
	};
}

/** An import without some of its specifiers: the whole import gone when it keeps none. */
export function importWithout(
	text: string,
	declaration: ESTree.ImportDeclaration,
	removed: ReadonlySet<Node>,
): Edit {
	const kept = declaration.specifiers.filter((each) => !removed.has(each));
	if (kept.length === 0) return deletion(text, declaration);
	const source = (node: Span) => text.slice(node.start, node.end);
	const named = kept.filter((each) => each.type === "ImportSpecifier");
	const clauses = [
		...kept.filter((each) => each.type !== "ImportSpecifier").map(source),
		...(named.length === 0 ? [] : [`{ ${named.map(source).join(", ")} }`]),
	];
	const from = source(declaration.source);
	const rest = text.slice(declaration.source.end, declaration.end);
	return {
		start: declaration.start,
		end: declaration.end,
		text: `import ${clauses.join(", ")} from ${from}${rest}`,
	};
}

/** What a pattern becomes without some of the names it binds. */
type PatternChange = "unchanged" | "emptied" | { text: string };

/**
 * A declaration without the names a pattern binds that `removed` holds: the pattern rewritten
 * without them, or the whole declaration gone when it binds nothing else. A declaration of several
 * names, or one the module exports, stays as it is.
 */
export function declarationWithout(
	text: string,
	declarator: ESTree.VariableDeclarator,
	declaration: Node | undefined,
	removed: ReadonlySet<Node>,
): Edit | undefined {
	const change = patternWithout(text, declarator.id, removed);
	if (change === "unchanged") return undefined;
	if (change !== "emptied") {
		const { start, end } = declarator.id;
		return { start, end, text: change.text };
	}
	const alone =
		declaration?.type === "VariableDeclaration" &&
		declaration.declarations.length === 1;
	return alone ? deletion(text, declaration) : undefined;
}

/** A pattern without the names `removed` holds, written from the source of what it keeps. */
function patternWithout(
	text: string,
	pattern: ESTree.BindingPattern,
	removed: ReadonlySet<Node>,
): PatternChange {
	const source = (node: Span) => text.slice(node.start, node.end);
	switch (pattern.type) {
		case "Identifier":
			return removed.has(pattern) ? "emptied" : "unchanged";
		case "ObjectPattern": {
			const kept = pattern.properties.filter(
				(property) =>
					property.type === "RestElement" || !removed.has(property.value),
			);
			if (kept.length === pattern.properties.length) return "unchanged";
			if (kept.length === 0) return "emptied";
			return { text: `{ ${kept.map(source).join(", ")} }` };
		}
		case "ArrayPattern": {
			const kept = pattern.elements.map((element) =>
				element !== null && removed.has(element) ? null : element,
			);
			if (kept.every((element, index) => element === pattern.elements[index])) {
				return "unchanged";
			}
			const last = kept.findLastIndex((element) => element !== null);
			if (last === -1) return "emptied";
			const elements = kept
				.slice(0, last + 1)
				.map((element) => (element === null ? "" : source(element)));
			return { text: `[${elements.join(", ")}]` };
		}
		default:
			return "unchanged";
	}
}
