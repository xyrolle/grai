import { categoriesOf, type PluralType } from "../plurals.ts";
import { MessageProblem } from "../problem.ts";
import {
	type Converted,
	escapeText,
	type ImportedMessage,
	type SourceEntry,
	textOf,
} from "./converted.ts";
import { IcuLocals } from "./icu-locals.ts";
import { pluralNeeds, selectNeeds } from "./icu-option-needs.ts";
import {
	type ChoiceKind,
	type IcuNode,
	type IcuOption,
	parseIcu,
} from "./icu-parse.ts";
import {
	followed,
	needing,
	plainReading,
	type Reading,
} from "./icu-readings.ts";
import { variantsOf } from "./icu-variants.ts";

/**
 * Converts one locale's ICU MessageFormat messages, as next-intl, react-intl and intl-messageformat
 * read them, to grai's format: `plural`, `selectordinal` and `select`, nested, in sequence or on
 * the same input again, become one selection with MessageFormat 2 selectors outermost first, `=n`
 * an exact match on the input, `other` the catch-all `*`, `#` the count formatted with `:number`,
 * as ICU formats it, a formatted argument its MessageFormat 2 call, and a tag markup. A message
 * grai cannot express gets the reason as its result.
 */
export function convertIcu(
	entries: readonly SourceEntry[],
	locale: string,
): ImportedMessage[] {
	return entries.map(({ path, value, description }) => {
		try {
			const result = convertMessage(textOf(value), locale);
			return { path, result, notes: [], description };
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			return { path, result: error, notes: [], description };
		}
	});
}

function convertMessage(source: string, locale: string): Converted {
	const nodes = parseIcu(source);
	const converter = new IcuConverter(locale, nodes);
	const readings = converter.expand(nodes, undefined);
	const { locals, selectors } = converter;
	return {
		declarations: locals.declarations,
		selectors,
		branches: variantsOf(
			readings,
			selectors.map((name) => ({ name, values: locals.categoriesOf(name) })),
		),
	};
}

/** Expands a message's nodes into the ways it reads, collecting the selectors and declarations. */
class IcuConverter {
	readonly selectors: string[] = [];
	readonly locals: IcuLocals;
	private readonly locale: string;

	constructor(locale: string, nodes: readonly IcuNode[]) {
		this.locale = locale;
		this.locals = new IcuLocals(locale, new Set(namesIn(nodes)));
	}

	/** Every way the nodes read, each with what it needs of the selectors; `#` shows `count`. */
	expand(nodes: readonly IcuNode[], count: string | undefined): Reading[] {
		let readings = [plainReading("")];
		for (const node of nodes) {
			readings = followed(readings, this.node(node, count));
		}
		return readings;
	}

	private node(node: IcuNode, count: string | undefined): Reading[] {
		switch (node.type) {
			case "text":
				return [plainReading(escapeText(node.value))];
			case "argument":
				return [
					plainReading(
						node.format === undefined
							? `{${node.name}}`
							: `{${node.name} ${node.format}}`,
					),
				];
			case "pound":
				return [plainReading(count === undefined ? "#" : `{${count} :number}`)];
			case "tag":
				return followed(
					followed(
						[plainReading(`{#${node.name}}`)],
						this.expand(node.children, count),
					),
					[plainReading(`{/${node.name}}`)],
				);
			case "choice":
				return node.kind === "select"
					? this.select(node, count)
					: this.plural(node, pluralTypes[node.kind]);
		}
	}

	private select(
		node: { name: string; options: IcuOption[] },
		count: string | undefined,
	): Reading[] {
		this.claim(node.name);
		for (const { key } of node.options) checkVariantKey(node.name, key);
		const keys = node.options.map(({ key }) => key);
		return node.options.flatMap(({ key, nodes }) =>
			this.expand(nodes, count).flatMap((reading) =>
				needing(reading, selectNeeds(node.name, key, keys)),
			),
		);
	}

	private plural(
		node: { name: string; options: IcuOption[] },
		type: PluralType,
	): Reading[] {
		const local = this.locals.plural(node.name, type);
		this.claim(local);
		if (node.options.some((option) => option.key.startsWith("="))) {
			this.claim(node.name, local);
		}
		// A category the locale does not have is never chosen, so it is dropped.
		const categories = categoriesOf(this.locale, type);
		const chosen = node.options.filter(
			({ key }) =>
				key.startsWith("=") || key === "other" || categories.includes(key),
		);
		for (const { key } of chosen) {
			checkVariantKey(node.name, key.replace(/^=/, ""));
		}
		const keys = chosen.map(({ key }) => key);
		return chosen.flatMap(({ key, nodes }) => {
			const needs = pluralNeeds(node.name, local, key, keys);
			return this.expand(nodes, node.name).flatMap((reading) =>
				needing(reading, needs),
			);
		});
	}

	/**
	 * Adds a selector, outermost first. Alternative branches may choose on the same one. An input's
	 * exact values go right before its plural category, as ICU tries `=n` before the categories.
	 */
	private claim(selector: string, before?: string) {
		if (this.selectors.includes(selector)) return;
		const at = before === undefined ? -1 : this.selectors.indexOf(before);
		if (at === -1) this.selectors.push(selector);
		else this.selectors.splice(at, 0, selector);
	}
}

/** The plural rules each of ICU's counting choices takes. */
const pluralTypes: Readonly<Record<Exclude<ChoiceKind, "select">, PluralType>> =
	{ plural: "cardinal", selectordinal: "ordinal" };

/** Every input the nodes read, in arguments and choices. */
function* namesIn(nodes: readonly IcuNode[]): Generator<string> {
	for (const node of nodes) {
		if (node.type === "argument") yield node.name;
		if (node.type === "tag") yield* namesIn(node.children);
		if (node.type === "choice") {
			yield node.name;
			for (const option of node.options) yield* namesIn(option.nodes);
		}
	}
}

/** A choice's key, which grai writes in a variant key as name=value. */
function checkVariantKey(name: string, key: string) {
	if (/[\s,=*]/.test(key) || key === "") {
		throw new MessageProblem(
			"unsupported",
			`the option "${key}" of {${name}} has a character a variant key cannot hold: a space, ",", "=" or "*".`,
		);
	}
}
