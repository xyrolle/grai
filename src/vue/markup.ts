import type { VNodeArrayChildren, VNodeChild } from "vue";

/** What a message writes on one of its elements, as in `{#link href=|/terms| @rel=nofollow}`. */
export type MarkupDetails = {
	options: Readonly<Record<string, unknown>>;
	attributes: Readonly<Record<string, string | true>>;
};

/** A message's part, as its `.parts()` gives it: a run of text, or a piece of its markup. */
export type MarkupPart<Tag extends string = string> =
	| { type: "text"; value: string }
	| ({
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: Tag;
	  } & MarkupDetails);

/**
 * Draws one markup element: what a `{#name}…{/name}` pair encloses, or nothing for `{#name/}`,
 * with the options and attributes the message writes on its start.
 */
export type MarkupElement = (
	children: VNodeArrayChildren | undefined,
	details: MarkupDetails,
) => VNodeChild;

/** The functions that draw a message's elements, one for each element its parts name. */
export type MarkupElements<Tag extends string = string> = Readonly<
	Record<Tag, MarkupElement>
>;

/** An element still open: its start, and what it encloses so far. */
type Open<Tag extends string> = {
	start: MarkupDetails & { name: Tag };
	children: VNodeArrayChildren;
};

/**
 * Renders a markup message's parts, each element drawn by its function in `markup`: translators
 * place the markup, and the app decides how it looks.
 *
 *     <Markup :parts="m.terms.parts()" :markup="{ link: (children) => h('a', { href: '/terms' }, children) }" />
 *
 * `markup` names exactly the elements the parts name: its type takes them from `parts`, so an
 * element missing from it, or one the message does not have, is a type error. An end closes the
 * innermost element of its name, an end with none open draws nothing, and an element left open
 * closes at the end. An element `markup` does not draw throws, naming it. A functional component:
 * it keeps no state, so it costs no instance.
 */
export function Markup<Tag extends string>({
	parts,
	markup,
}: {
	parts: readonly MarkupPart<Tag>[];
	markup: MarkupElements<NoInfer<Tag>>;
}): VNodeArrayChildren {
	const root: VNodeArrayChildren = [];
	const open: Open<Tag>[] = [];
	const current = () => open.at(-1)?.children ?? root;
	const draw = (
		{ name, options, attributes }: Open<Tag>["start"],
		children?: VNodeArrayChildren,
	) => {
		// Undefined only for parts whose type does not name their elements.
		const element: MarkupElement | undefined = markup[name];
		if (element === undefined) {
			throw new Error(
				`Markup has no function for the message's element "${name}". Add ${name} to its markup.`,
			);
		}
		return element(children, { options, attributes });
	};
	/** Closes the elements open from `depth` in, innermost first, each into the one around it. */
	const closeFrom = (depth: number) => {
		let inner: VNodeArrayChildren = [];
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
	return root;
}
