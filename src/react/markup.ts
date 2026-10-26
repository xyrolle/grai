import { createElement, Fragment, type ReactNode } from "react";
import { ownEntry } from "../own-entry.ts";

/**
 * A message's part, as its `.parts()` gives it: the runtime's `MessagePart`, a run of text or a
 * piece of markup named by one of the message's tags.
 */
type MessagePart<Tag extends string> =
	| { type: "text"; value: string }
	| {
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: Tag;
			options: Readonly<Record<string, unknown>>;
			attributes: Readonly<Record<string, string | true>>;
	  };

/** Draws one markup element: what a `{#name}…{/name}` pair encloses, or nothing for `{#name/}`. */
type MarkupElement = (children?: ReactNode) => ReactNode;

/** An element still open: its name and what it encloses so far. */
type Open<Tag extends string> = { name: Tag; children: ReactNode[] };

/**
 * Renders a markup message's parts, each element drawn by its function in `markup`: translators
 * place the markup, and the app decides how it looks. An end closes the innermost element of its
 * name, an end with none open draws nothing, and an element left open closes at the end. An
 * element `markup` does not draw throws, naming it: `markup`'s own functions draw, so an element
 * the catalog names `constructor` is none of them.
 */
export function Markup<Tag extends string>({
	parts,
	markup,
}: {
	parts: readonly MessagePart<Tag>[];
	markup: Readonly<Record<Tag, MarkupElement>>;
}): ReactNode {
	const root: ReactNode[] = [];
	const open: Open<Tag>[] = [];
	const current = () => open.at(-1)?.children ?? root;
	const draw = (name: Tag, children?: ReactNode[]) => {
		const element = ownEntry(markup, name);
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
