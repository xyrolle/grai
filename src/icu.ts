import {
	type Branch,
	type Converted,
	escapeText,
	pluralLocalName,
	pluralOptionKeys,
} from "./converted.ts";
import { categoriesOf } from "./plurals.ts";
import { MessageProblem } from "./problem.ts";

/** An ICU MessageFormat message, parsed. */
type IcuNode =
	| { type: "text"; value: string }
	| { type: "argument"; name: string }
	| { type: "pound" }
	| {
			type: "choice";
			kind: "plural" | "select";
			name: string;
			options: Option[];
	  }
	| { type: "tag"; name: string; children: IcuNode[] };
type Option = { key: string; nodes: IcuNode[] };

const inputName = /^[A-Za-z_$][\w$]*$/;
const tagName = /^[A-Za-z][\w-]*$/;

/**
 * Converts an ICU MessageFormat message, as next-intl, react-intl and intl-messageformat read it,
 * to grai's format: `plural` and `select`, nested or in sequence, become MessageFormat 2 selectors
 * outermost first, `=n` an exact match on the input, `other` the catch-all `*`, `#` the count and
 * a tag markup. Formatted arguments (`number`, `date`, `time`), `selectordinal` and `offset` throw
 * a `MessageProblem`. `notes` gets what renders differently.
 */
export function convertIcu(
	source: string,
	locale: string,
	notes: string[],
): Converted {
	const nodes = new IcuParser(source).message();
	const converter = new IcuConverter(locale, nodes);
	const branches = converter.expand(nodes, undefined);
	if (converter.showsCount) {
		notes.push(
			"# shows the count as written (1000), where ICU formats it for the locale (1,000).",
		);
	}
	return {
		declarations: converter.declarations,
		selectors: converter.selectors,
		branches,
	};
}

class IcuParser {
	private readonly source: string;
	private index = 0;

	constructor(source: string) {
		this.source = source;
	}

	message(): IcuNode[] {
		const nodes = this.nodes(false, undefined);
		if (this.index < this.source.length) {
			throw invalid(`the } at ${this.index} closes nothing.`);
		}
		return nodes;
	}

	/** Nodes up to a `}` or the closing tag, which is left unread; `#` is the count within a plural. */
	private nodes(inPlural: boolean, closingTag: string | undefined): IcuNode[] {
		const nodes: IcuNode[] = [];
		let text = "";
		const flush = () => {
			if (text !== "") nodes.push({ type: "text", value: text });
			text = "";
		};
		while (this.index < this.source.length) {
			const char = this.source.charAt(this.index);
			if (char === "}") break;
			if (
				closingTag !== undefined &&
				this.source.startsWith(`</${closingTag}>`, this.index)
			)
				break;
			if (char === "'") {
				text += this.quoted(inPlural);
			} else if (char === "{") {
				flush();
				nodes.push(this.argument());
			} else if (char === "#" && inPlural) {
				flush();
				nodes.push({ type: "pound" });
				this.index++;
			} else if (char === "<" && this.tagAhead() !== undefined) {
				flush();
				nodes.push(this.tag(inPlural));
			} else {
				text += char;
				this.index++;
			}
		}
		flush();
		return nodes;
	}

	/** ICU's apostrophe: `''` is one, and one before a special character quotes text up to the next. */
	private quoted(inPlural: boolean): string {
		const next = this.source.charAt(this.index + 1);
		if (next === "'") {
			this.index += 2;
			return "'";
		}
		if (!"{}<>|".includes(next) && !(inPlural && next === "#")) {
			this.index++;
			return "'";
		}
		let text = "";
		this.index++;
		while (this.index < this.source.length) {
			const char = this.source.charAt(this.index);
			if (char === "'") {
				if (this.source.charAt(this.index + 1) !== "'") {
					this.index++;
					return text;
				}
				this.index++;
			}
			text += char;
			this.index++;
		}
		return text;
	}

	private argument(): IcuNode {
		this.index++;
		const name = this.word();
		if (this.take("}")) return { type: "argument", name: inputOf(name) };
		if (!this.take(",")) throw invalid(`{${name} must be closed by }.`);
		const kind = this.word();
		if (kind !== "plural" && kind !== "select") {
			throw new MessageProblem(
				"unsupported",
				kind === "selectordinal"
					? `{${name}, selectordinal} picks an ordinal form, which grai does not support yet.`
					: `{${name}, ${kind}} formats the value as ${functionOf(kind)}, which grai does not support yet. Format it before the call and pass the text as {${name}}.`,
			);
		}
		if (!this.take(","))
			throw invalid(`{${name}, ${kind} must list its options.`);
		const options: Option[] = [];
		for (;;) {
			this.space();
			if (this.take("}")) break;
			const key = this.word();
			if (key.startsWith("offset:")) {
				throw new MessageProblem(
					"unsupported",
					`{${name}, plural, ${key}} subtracts an offset from the count, which grai does not support.`,
				);
			}
			if (key === "" || !this.take("{")) {
				throw invalid(
					`each option of {${name}, ${kind}} must be a key and a message in braces.`,
				);
			}
			options.push({ key, nodes: this.nodes(kind === "plural", undefined) });
			if (!this.take("}"))
				throw invalid(`the option ${key} of {${name}} must be closed by }.`);
		}
		if (!options.some((option) => option.key === "other")) {
			throw invalid(
				`{${name}, ${kind}} has no other option, which ICU requires.`,
			);
		}
		return { type: "choice", kind, name: inputOf(name), options };
	}

	private tag(inPlural: boolean): IcuNode {
		const name = this.tagAhead() ?? "";
		this.index += name.length + 2;
		const children = this.nodes(inPlural, name);
		if (!this.source.startsWith(`</${name}>`, this.index)) {
			throw invalid(`the tag <${name}> must be closed by </${name}>.`);
		}
		this.index += name.length + 3;
		return { type: "tag", name, children };
	}

	/** The name of an opening tag at the index, if there is one. */
	private tagAhead(): string | undefined {
		const end = this.source.indexOf(">", this.index);
		const name = end === -1 ? "" : this.source.slice(this.index + 1, end);
		return tagName.test(name) ? name : undefined;
	}

	/** Skips spaces, then reads up to a space, `,`, `{` or `}`. */
	private word(): string {
		this.space();
		const start = this.index;
		while (
			this.index < this.source.length &&
			!/[\s,{}]/.test(this.source.charAt(this.index))
		) {
			this.index++;
		}
		const word = this.source.slice(start, this.index);
		this.space();
		return word;
	}

	private take(char: string): boolean {
		this.space();
		if (this.source.charAt(this.index) !== char) return false;
		this.index++;
		return true;
	}

	private space() {
		while (/\s/.test(this.source.charAt(this.index))) this.index++;
	}
}

class IcuConverter {
	readonly declarations: string[] = [];
	readonly selectors: string[] = [];
	/** Whether a `#` shows a count, which ICU formats for the locale and grai renders as written. */
	showsCount = false;
	private readonly locale: string;
	private readonly taken: ReadonlySet<string>;
	/** Each counted input's plural local, declared once. */
	private readonly locals = new Map<string, string>();

	constructor(locale: string, nodes: readonly IcuNode[]) {
		this.locale = locale;
		this.taken = new Set(namesIn(nodes));
	}

	/** Every way the nodes read, each with the selector values it needs; `count` is what `#` shows. */
	expand(nodes: readonly IcuNode[], count: string | undefined): Branch[] {
		let branches: Branch[] = [{ keys: new Map(), pattern: "" }];
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
				return [{ keys: new Map(), pattern: escapeText(node.value) }];
			case "argument":
				return [{ keys: new Map(), pattern: `{${node.name}}` }];
			case "pound":
				this.showsCount = true;
				return [
					{
						keys: new Map(),
						pattern: count === undefined ? "#" : `{${count}}`,
					},
				];
			case "tag":
				return combine(
					combine(
						[{ keys: new Map(), pattern: `{#${node.name}}` }],
						this.expand(node.children, count),
					),
					[{ keys: new Map(), pattern: `{/${node.name}}` }],
				);
			case "choice":
				return node.kind === "select"
					? this.select(node, count)
					: this.plural(node);
		}
	}

	private select(
		node: { name: string; options: Option[] },
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

	private plural(node: { name: string; options: Option[] }): Branch[] {
		let local = this.locals.get(node.name);
		if (local === undefined) {
			local = pluralLocalName(node.name, this.taken);
			this.locals.set(node.name, local);
			this.declarations.push(`local ${local} = ${node.name}: plural`);
		}
		this.claim(local);
		if (node.options.some((option) => option.key.startsWith("="))) {
			this.claim(node.name, local);
		}
		const categories = categoriesOf(this.locale);
		// A category the locale does not have is never chosen, so it is dropped.
		const chosen = node.options.filter(
			({ key }) =>
				key.startsWith("=") || key === "other" || categories.includes(key),
		);
		for (const { key } of chosen)
			checkVariantKey(node.name, key.replace(/^=/, ""));
		return chosen.flatMap(({ key, nodes }) =>
			this.expand(nodes, node.name).map((branch) =>
				withKeys(branch, pluralOptionKeys(node.name, local, key)),
			),
		);
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

/** Each branch of `a` followed by each of `b`, with the selector values both need. */
function combine(a: readonly Branch[], b: readonly Branch[]): Branch[] {
	return a.flatMap((first) =>
		b.map((second) => ({
			keys: new Map([...first.keys, ...second.keys]),
			pattern: first.pattern + second.pattern,
		})),
	);
}

function withKeys(branch: Branch, keys: readonly [string, string][]): Branch {
	return { keys: new Map([...branch.keys, ...keys]), pattern: branch.pattern };
}

/** The inputs a node chooses on, its own choice and the ones nested in it. */
function* choicesIn(node: IcuNode): Generator<string> {
	if (node.type === "tag")
		for (const child of node.children) yield* choicesIn(child);
	if (node.type === "choice") {
		yield node.name;
		for (const option of node.options) {
			for (const child of option.nodes) yield* choicesIn(child);
		}
	}
}

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

function inputOf(name: string): string {
	if (!inputName.test(name)) {
		throw new MessageProblem(
			"unsupported",
			`{${name}} is not a name grai can take as an input. Rename it, such as {count}, here and where the message is called.`,
		);
	}
	return name;
}

function functionOf(kind: string): string {
	return kind === "number"
		? ":number"
		: kind === "date" || kind === "time"
			? ":datetime"
			: `:${kind}`;
}

function invalid(detail: string): MessageProblem {
	return new MessageProblem(
		"message-invalid",
		`it is not a valid ICU message: ${detail}`,
	);
}
