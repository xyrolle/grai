import { ownEntry } from "../own-entry.ts";
import { MessageProblem } from "../problem.ts";
import { dateSkeletonCall, numberSkeletonCall } from "./icu-skeletons.ts";

/**
 * An ICU MessageFormat message, parsed: text, `{name}`, `#`, a plural, ordinal or select choice,
 * and a tag.
 * A formatted argument, such as `{price, number}`, has the MessageFormat 2 call that formats it
 * alike, such as `:number`.
 */
export type IcuNode =
	| { type: "text"; value: string }
	| { type: "argument"; name: string; format?: string }
	| { type: "pound" }
	| {
			type: "choice";
			kind: ChoiceKind;
			name: string;
			options: IcuOption[];
	  }
	| { type: "tag"; name: string; children: IcuNode[] };

/** A choice as ICU names it: by a count's plural or ordinal category, or by a value. */
export type ChoiceKind = "plural" | "selectordinal" | "select";

/** One option of a choice: its key (`one`, `=0`, `male`, `other`) and its message. */
export type IcuOption = { key: string; nodes: IcuNode[] };

const inputName = /^[A-Za-z_$][\w$]*$/;
const tagName = /^[A-Za-z][\w-]*$/;
/** The characters before which an apostrophe starts quoted text; a plural's `#` is one too. */
const quotable: ReadonlySet<string> = new Set(["{", "}", "<", ">"]);
/**
 * The MessageFormat 2 call that formats an ICU argument as intl-messageformat does, by its type and
 * style: its `number` styles, and the Intl options of its `date` and `time` styles. A date without
 * a style takes Intl's default fields; a time without one is a medium time.
 */
const formats: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	number: {
		"": ":number",
		integer: ":integer",
		percent: ":number style=percent",
	},
	date: {
		"": ":date year=numeric month=numeric day=numeric",
		short: ":date year=2-digit month=numeric day=numeric",
		medium: ":date year=numeric month=short day=numeric",
		long: ":date year=numeric month=long day=numeric",
		full: ":date weekday=long year=numeric month=long day=numeric",
	},
	time: {
		"": ":time hour=numeric minute=numeric second=numeric",
		short: ":time hour=numeric minute=numeric",
		medium: ":time hour=numeric minute=numeric second=numeric",
		long: ":time hour=numeric minute=numeric second=numeric timeZoneName=short",
		full: ":time hour=numeric minute=numeric second=numeric timeZoneName=short",
	},
};

/**
 * Parses an ICU message as intl-messageformat reads it. A currency or skeleton style, an argument
 * of another type or `offset` throws an "unsupported" MessageProblem, and a malformed message a
 * "message-invalid" one.
 */
export function parseIcu(source: string): IcuNode[] {
	return new IcuParser(source).message();
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
		while (this.index < this.source.length && !this.atEnd(closingTag)) {
			const char = this.source.charAt(this.index);
			const tag = char === "<" ? this.tagAhead() : undefined;
			if (char === "'") {
				text += this.quoted(inPlural);
			} else if (char === "{") {
				flush();
				nodes.push(this.argument());
			} else if (char === "#" && inPlural) {
				flush();
				nodes.push({ type: "pound" });
				this.index++;
			} else if (tag !== undefined) {
				flush();
				nodes.push(this.tag(tag, inPlural));
			} else {
				text += char;
				this.index++;
			}
		}
		flush();
		return nodes;
	}

	private atEnd(closingTag: string | undefined): boolean {
		return (
			this.source.charAt(this.index) === "}" ||
			(closingTag !== undefined &&
				this.source.startsWith(`</${closingTag}>`, this.index))
		);
	}

	/**
	 * ICU's apostrophe, as ICU 4.8 and intl-messageformat read it: `''` is one, and one right before
	 * a quotable character quotes text up to the next. Any other apostrophe is itself.
	 */
	private quoted(inPlural: boolean): string {
		const next = this.source.charAt(this.index + 1);
		if (next === "'") {
			this.index += 2;
			return "'";
		}
		if (!quotable.has(next) && !(inPlural && next === "#")) {
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

	/** `{name}`, or a choice: `{name, plural|select, options}`. */
	private argument(): IcuNode {
		this.index++;
		const name = this.word();
		if (this.take("}")) return { type: "argument", name: inputOf(name) };
		if (!this.take(",")) throw invalid(`{${name} must be closed by }.`);
		const kind = this.word();
		if (Object.hasOwn(formats, kind)) return this.formatted(name, kind);
		if (!isChoiceKind(kind)) throw unsupportedArgument(name, kind);
		if (!this.take(",")) {
			throw invalid(`{${name}, ${kind} must list its options.`);
		}
		const options = this.options(name, kind);
		if (!options.some((option) => option.key === "other")) {
			throw invalid(
				`{${name}, ${kind}} has no other option, which ICU requires.`,
			);
		}
		return { type: "choice", kind, name: inputOf(name), options };
	}

	/** The rest of a formatted argument, `{name, type` read: its style, if any, and its `}`. */
	private formatted(name: string, kind: string): IcuNode {
		const style = this.take(",") ? this.styleText() : "";
		if (!this.take("}"))
			throw invalid(`{${name}, ${kind} must be closed by }.`);
		if (style.startsWith("::")) {
			const written = `{${name}, ${kind}, ${style}}`;
			const skeleton = style.slice(2);
			const format =
				kind === "number"
					? numberSkeletonCall(skeleton, written)
					: dateSkeletonCall(skeleton, written);
			return { type: "argument", name: inputOf(name), format };
		}
		const format = ownEntry(formats[kind] ?? {}, style);
		if (format === undefined) {
			throw new MessageProblem(
				"unsupported",
				`{${name}, ${kind}, ${style}} formats with a style grai import does not convert. Write it as {${name} ${formats[kind]?.[""] ?? ""}} with the options it needs.`,
			);
		}
		return { type: "argument", name: inputOf(name), format };
	}

	/** A choice's options up to its closing `}`, each a key and a message in braces. */
	private options(name: string, kind: ChoiceKind): IcuOption[] {
		const options: IcuOption[] = [];
		while (!this.take("}")) {
			const key = this.word();
			if (key.startsWith("offset:")) {
				throw new MessageProblem(
					"unsupported",
					`{${name}, ${kind}, ${key}} subtracts an offset from the count, which grai does not support.`,
				);
			}
			if (key === "" || !this.take("{")) {
				throw invalid(
					`each option of {${name}, ${kind}} must be a key and a message in braces.`,
				);
			}
			options.push({ key, nodes: this.nodes(kind !== "select", undefined) });
			if (!this.take("}")) {
				throw invalid(`the option ${key} of {${name}} must be closed by }.`);
			}
		}
		return options;
	}

	private tag(name: string, inPlural: boolean): IcuNode {
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
	/** A formatted argument's style, as written up to its closing brace: a name, or a skeleton. */
	private styleText(): string {
		const end = this.source.indexOf("}", this.index);
		const style = this.source.slice(this.index, end === -1 ? undefined : end);
		this.index += style.length;
		return style.trim();
	}

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

function inputOf(name: string): string {
	if (!inputName.test(name)) {
		throw new MessageProblem(
			"unsupported",
			`{${name}} is not a name grai can take as an input. Rename it, such as {count}, here and where the message is called.`,
		);
	}
	return name;
}

function isChoiceKind(kind: string): kind is ChoiceKind {
	return kind === "plural" || kind === "selectordinal" || kind === "select";
}

/** Why an argument of a type other than a choice, number, date or time cannot be converted. */
function unsupportedArgument(name: string, kind: string): MessageProblem {
	return new MessageProblem(
		"unsupported",
		`{${name}, ${kind}} formats the value as ${kind}, which grai does not support. Format it before the call and pass the text as {${name}}.`,
	);
}

function invalid(detail: string): MessageProblem {
	return new MessageProblem(
		"message-invalid",
		`it is not a valid ICU message: ${detail}`,
	);
}
