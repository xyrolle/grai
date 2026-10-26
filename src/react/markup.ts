import { createElement, Fragment, type ReactNode } from "react";
import { ownEntry } from "../own-entry.ts";

/** A piece of a message's markup, as its `.parts()` gives it: an element's start, its end, or all of it. */
type MarkupPart<Tag extends string> = {
	type: "markup-start" | "markup-end" | "markup-standalone";
	name: Tag;
	options: Readonly<Record<string, unknown>>;
	attributes: Readonly<Record<string, string | true>>;
};

/**
 * A message's part, as its `.parts()` gives it: the runtime's `MessagePart`, a run of text or a
 * piece of markup named by one of the message's tags.
 */
type MessagePart<Tag extends string> =
	| { type: "text"; value: string }
	| MarkupPart<Tag>;

/** What a message writes on one of its elements: `href` and `@translate` in `{#link href=|/terms| @translate=no}`. */
type MarkupDetails = Pick<MarkupPart<string>, "options" | "attributes">;

/**
 * Draws one markup element: what a `{#name}…{/name}` pair encloses, or nothing for `{#name/}`,
 * with the options and attributes the message writes on its start.
 */
type MarkupElement = (
	children: ReactNode | undefined,
	details: MarkupDetails,
) => ReactNode;

/** An element still open: its start, and what it encloses so far. */
type Open<Tag extends string> = {
	start: MarkupPart<Tag>;
	children: ReactNode[];
};

/**
 * Renders a markup message's parts, each element drawn by its function in `markup`: translators
 * place the markup, and the app decides how it looks. An end closes the innermost element of its
 * name, an end with none open draws nothing, and an element left open closes at the end. An
 * element `markup` does not draw throws, naming it: `markup`'s own functions draw, so an element
 * the catalog names `constructor` is none of them. Each function takes the options and attributes
 * the message writes on its element, and decides what they do: they are the translators', so none
 * reaches the page but through the app's function.
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
	const draw = (
		{ name, options, attributes }: MarkupPart<Tag>,
		children?: ReactNode[],
	) => {
		const element = ownEntry(markup, name);
		if (element === undefined) {
			throw new Error(
				`Markup has no function for the message's element "${name}". Add ${name} to its markup.`,
			);
		}
		return element(children && createElement(Fragment, null, ...children), {
			options,
			attributes,
		});
	};
	/** Closes the elements open from `depth` in, innermost first, each into the one around it. */
	const closeFrom = (depth: number) => {
		let inner: ReactNode[] = [];
		for (const element of open.splice(depth).toReversed()) {
			inner = [draw(element.start, [...element.children, ...inner])];
		}
		current().push(...inner);
	};

	for (const part of parts) {
		if (part.type === "text") current().push(part.value);
		else if (part.type === "markup-standalone") current().push(draw(part));
		else if (part.type === "markup-start") {
			open.push({ start: part, children: [] });
		} else {
			const at = open.findLastIndex(({ start }) => start.name === part.name);
			if (at !== -1) closeFrom(at);
		}
	}
	closeFrom(0);
	return createElement(Fragment, null, ...root);
}
