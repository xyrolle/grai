import type { IcuNode } from "./icu-parse.ts";
import { IcuScanner, invalid } from "./icu-scanner.ts";

/** The characters before which an apostrophe starts quoted text; a plural's `#` is one too. */
const quotable: ReadonlySet<string> = new Set(["{", "}", "<", ">"]);

/** Where a pattern is read: whether a `</` may end it, and whether `#` is the count there. */
export type PatternScope = {
	/** Inside a tag, where a `</` ends the pattern; outside every tag it closes none. */
	inTag: boolean;
	/** Directly in a plural's or an ordinal's option, or in a tag there, where `#` is the count. */
	counted: boolean;
};

/**
 * Reads an ICU message's patterns: their text, apostrophes, `#` and tags, around the arguments in
 * braces, which the parser reads.
 */
export abstract class IcuPatternReader extends IcuScanner {
	/** Reads the argument in braces at the index, in a pattern of this scope. */
	protected abstract argument(scope: PatternScope): IcuNode;

	message(): IcuNode[] {
		const nodes = this.nodes({ inTag: false, counted: false });
		if (this.index < this.source.length) {
			throw invalid(`the } at ${this.index} closes nothing.`);
		}
		return nodes;
	}

	/** A pattern's nodes, up to the `}` or the tag's `</` that ends it, which is left unread. */
	protected nodes(scope: PatternScope): IcuNode[] {
		const nodes: IcuNode[] = [];
		let text = "";
		const flush = () => {
			if (text !== "") nodes.push({ type: "text", value: text });
			text = "";
		};
		while (this.index < this.source.length && !this.atEnd(scope)) {
			const char = this.source.charAt(this.index);
			if (char === "'") {
				text += this.quoted(scope.counted);
			} else if (char === "{") {
				flush();
				nodes.push(this.argument(scope));
			} else if (char === "#" && scope.counted) {
				flush();
				nodes.push({ type: "pound" });
				this.index++;
			} else if (char === "<" && this.tagAhead()) {
				flush();
				nodes.push(this.tag(scope));
			} else {
				text += char;
				this.index++;
			}
		}
		flush();
		return nodes;
	}

	/** Whether the pattern ends here, at a `}` or a `</`, which outside every tag closes none. */
	private atEnd(scope: PatternScope): boolean {
		if (this.source.charAt(this.index) === "}") return true;
		if (!this.source.startsWith("</", this.index)) return false;
		if (scope.inTag) return true;
		throw invalid(`the </ at ${this.index} closes no tag.`);
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

	/** Whether a tag opens here: a `<` and an ASCII letter. */
	private tagAhead(): boolean {
		return /[A-Za-z]/.test(this.source.charAt(this.index + 1));
	}

	/**
	 * `<name>`, its pattern and `</name>`, as intl-messageformat reads a tag: spaces may come before
	 * each `>`, and `<name/>` is text.
	 */
	private tag(scope: PatternScope): IcuNode {
		this.index++;
		const name = this.tagName();
		if (this.take("/>")) return { type: "text", value: `<${name}/>` };
		if (!this.take(">")) {
			throw invalid(`the tag <${name} must end with > or />.`);
		}
		const children = this.nodes({ inTag: true, counted: scope.counted });
		if (!this.closes(name)) {
			throw invalid(`the tag <${name}> must be closed by </${name}>.`);
		}
		return { type: "tag", name, children };
	}

	/** Reads the `</name>` that closes the tag, if it is here. */
	private closes(name: string): boolean {
		if (!this.source.startsWith("</", this.index)) return false;
		this.index += 2;
		return this.tagName() === name && this.take(">");
	}
}
