import { createElement, Fragment, type ReactNode } from "react";

/** A message's part, as its `.parts()` gives it: a run of text, or a piece of its markup. */
export type MarkupPart =
	| { type: "text"; value: string }
	| {
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: string;
	  };

/** Draws one markup element: what a `{#name}…{/name}` pair encloses, or nothing for `{#name/}`. */
export type MarkupElement = (children?: ReactNode) => ReactNode;

/** An element still open: its name and what it encloses so far. */
type Open = { name: string; children: ReactNode[] };

/**
 * Renders a markup message's parts, each element drawn by its function in `markup`: translators
 * place the markup, and the app decides how it looks. An end closes the innermost element of its
 * name, an end with none open draws nothing, and an element left open closes at the end. An
 * element `markup` does not draw throws, naming it.
 */
export function Markup({
	parts,
	markup,
}: {
	parts: readonly MarkupPart[];
	markup: Readonly<Record<string, MarkupElement>>;
}): ReactNode {
	const root: ReactNode[] = [];
	const open: Open[] = [];
	const current = () => open.at(-1)?.children ?? root;
	const draw = (name: string, children?: ReactNode[]) => {
		const element = markup[name];
		if (element === undefined) {
			throw new Error(
				`Markup has no function for the message's element "${name}". Add ${name} to its markup.`,
			);
		}
		return element(children && createElement(Fragment, null, ...children));
	};
	/** Closes the elements open from `depth` in, innermost first, each into the one around it. */
	const closeFrom = (depth: number) => {
		let inner: ReactNode[] = [];
		for (const element of open.splice(depth).toReversed()) {
			inner = [draw(element.name, [...element.children, ...inner])];
		}
		current().push(...inner);
	};

	for (const part of parts) {
		if (part.type === "text") current().push(part.value);
		else if (part.type === "markup-standalone") current().push(draw(part.name));
		else if (part.type === "markup-start") {
			open.push({ name: part.name, children: [] });
		} else {
			const at = open.findLastIndex((element) => element.name === part.name);
			if (at !== -1) closeFrom(at);
		}
	}
	closeFrom(0);
	return createElement(Fragment, null, ...root);
}
