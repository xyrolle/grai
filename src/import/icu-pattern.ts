import type { IcuNode } from "./icu-parse.ts";
import { IcuScanner, invalid } from "./icu-scanner.ts";

const tagName = /^[A-Za-z][\w-]*$/;

/**
 * Reads an ICU message's patterns: their text, apostrophes, `#` and tags, around the arguments in
 * braces, which the parser reads.
 */
export abstract class IcuPatternReader extends IcuScanner {
	/** Reads the argument in braces at the index. */
	protected abstract argument(): IcuNode;

	message(): IcuNode[] {
		const nodes = this.nodes(false, undefined);
		if (this.index < this.source.length) {
			throw invalid(`the } at ${this.index} closes nothing.`);
		}
		return nodes;
	}

	/** Nodes up to a `}` or the closing tag, which is left unread; `#` is the count within a plural. */
	protected nodes(
		inPlural: boolean,
		closingTag: string | undefined,
	): IcuNode[] {
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
}
