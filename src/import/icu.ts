import { categoriesOf } from "../plurals.ts";
import { MessageProblem } from "../problem.ts";
import {
	type Branch,
	type Converted,
	combine,
	escapeText,
	type ImportedMessage,
	plain,
	pluralLocalName,
	pluralOptionKeys,
	type SourceEntry,
	textOf,
	withKeys,
} from "./converted.ts";
import { type IcuNode, type IcuOption, parseIcu } from "./icu-parse.ts";

/**
 * Converts one locale's ICU MessageFormat messages, as next-intl, react-intl and intl-messageformat
 * read them, to grai's format: `plural` and `select`, nested or in sequence, become MessageFormat 2
 * selectors outermost first, `=n` an exact match on the input, `other` the catch-all `*`, `#` the
 * count formatted with `:number`, as ICU formats it, a formatted argument its MessageFormat 2 call,
 * and a tag markup. A message grai cannot express gets the reason as its result.
 */
export function convertIcu(
	entries: readonly SourceEntry[],
	locale: string,
): ImportedMessage[] {
	return entries.map(({ path, value }) => {
		try {
			return { path, result: convertMessage(textOf(value), locale), notes: [] };
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			return { path, result: error, notes: [] };
		}
	});
}

function convertMessage(source: string, locale: string): Converted {
	const nodes = parseIcu(source);
	const converter = new IcuConverter(locale, nodes);
	const branches = converter.expand(nodes, undefined);
	return {
		declarations: converter.declarations,
		selectors: converter.selectors,
		branches,
	};
}

/** Expands a message's nodes into its branches, and collects the selectors and declarations they need. */
class IcuConverter {
	readonly declarations: string[] = [];
	readonly selectors: string[] = [];
	private readonly categories: readonly string[];
	/** The message's inputs, which a plural local's name must not take. */
	private readonly inputs: ReadonlySet<string>;
	/** Each counted input's plural local, declared once. */
	private readonly locals = new Map<string, string>();

	constructor(locale: string, nodes: readonly IcuNode[]) {
		this.categories = categoriesOf(locale);
		this.inputs = new Set(namesIn(nodes));
	}

	/** Every way the nodes read, each with the selector values it needs; `count` is what `#` shows. */
	expand(nodes: readonly IcuNode[], count: string | undefined): Branch[] {
		let branches: Branch[] = [plain("")];
		const chosen = new Set<string>();
		for (const node of nodes) {
			for (const name of new Set(choicesIn(node))) {
				if (chosen.has(name)) {
					throw new MessageProblem(
						"unsupported",
						`it chooses on ${name} twice in one sentence, which grai cannot express. Choose once, around the whole sentence.`,
					);
				}
				chosen.add(name);
			}
			branches = combine(branches, this.node(node, count));
		}
		return branches;
	}

	private node(node: IcuNode, count: string | undefined): Branch[] {
		switch (node.type) {
			case "text":
				return [plain(escapeText(node.value))];
			case "argument":
				return [
					plain(
						node.format === undefined
							? `{${node.name}}`
							: `{${node.name} ${node.format}}`,
					),
				];
			case "pound":
				return [plain(count === undefined ? "#" : `{${count} :number}`)];
			case "tag":
				return combine(
					combine(
						[plain(`{#${node.name}}`)],
						this.expand(node.children, count),
					),
					[plain(`{/${node.name}}`)],
				);
			case "choice":
				return node.kind === "select"
					? this.select(node, count)
					: this.plural(node);
		}
	}

	private select(
		node: { name: string; options: IcuOption[] },
		count: string | undefined,
	): Branch[] {
		this.claim(node.name);
		for (const { key } of node.options) checkVariantKey(node.name, key);
		return node.options.flatMap(({ key, nodes }) =>
			this.expand(nodes, count).map((branch) =>
				key === "other" ? branch : withKeys(branch, [[node.name, key]]),
			),
		);
	}

	private plural(node: { name: string; options: IcuOption[] }): Branch[] {
		const local = this.pluralLocal(node.name);
		this.claim(local);
		if (node.options.some((option) => option.key.startsWith("="))) {
			this.claim(node.name, local);
		}
		// A category the locale does not have is never chosen, so it is dropped.
		const chosen = node.options.filter(
			({ key }) =>
				key.startsWith("=") || key === "other" || this.categories.includes(key),
		);
		for (const { key } of chosen) {
			checkVariantKey(node.name, key.replace(/^=/, ""));
		}
		return chosen.flatMap(({ key, nodes }) =>
			this.expand(nodes, node.name).map((branch) =>
				withKeys(branch, pluralOptionKeys(node.name, local, key)),
			),
		);
	}

	/** The local that holds an input's plural category, declared the first time a plural counts it. */
	private pluralLocal(input: string): string {
		const known = this.locals.get(input);
		if (known !== undefined) return known;
		const local = pluralLocalName(input, this.inputs);
		this.locals.set(input, local);
		this.declarations.push(`local ${local} = ${input}: plural`);
		return local;
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

/** The inputs a node chooses on, its own choice and the ones nested in it. */
function* choicesIn(node: IcuNode): Generator<string> {
	if (node.type === "tag") {
		for (const child of node.children) yield* choicesIn(child);
	}
	if (node.type === "choice") {
		yield node.name;
		for (const option of node.options) {
			for (const child of option.nodes) yield* choicesIn(child);
		}
	}
}

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
