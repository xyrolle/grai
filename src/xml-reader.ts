/**
 * Reading the XML grai's XLIFF needs, and no more. The reader is strict: no DTD, no entities beyond
 * XML's five and numeric references, and every tag closed. A tool's comments, processing
 * instructions and CDATA are read past or as text.
 */

import { ownEntry } from "./own-entry.ts";
import { isXmlCharacter } from "./xml-text.ts";

/** An element, with its attributes and its content in order. */
export type XmlElement = {
	name: string;
	attributes: ReadonlyMap<string, string>;
	children: readonly XmlNode[];
};

export type XmlNode = XmlElement | string;

/** A document grai cannot read, at an offset of its text. */
export class XmlError extends Error {
	readonly offset: number;

	constructor(offset: number, detail: string) {
		super(`at character ${offset}: ${detail}`);
		this.offset = offset;
	}
}

const nameStart = /[A-Za-z_:]/;
const nameCharacter = /[\w.:-]/;
const entities: Readonly<Record<string, string>> = {
	lt: "<",
	gt: ">",
	amp: "&",
	quot: '"',
	apos: "'",
};

/** Reads a document's root element. Throws an XmlError for anything outside the subset. */
export function readXml(text: string): XmlElement {
	return new XmlReader(text).document();
}

class XmlReader {
	private readonly text: string;
	private index = 0;

	constructor(text: string) {
		this.text = text.startsWith("﻿") ? text.slice(1) : text;
	}

	document(): XmlElement {
		this.misc();
		if (
			!this.text.startsWith("<", this.index) ||
			this.text.startsWith("</", this.index)
		) {
			throw new XmlError(this.index, "the document has no root element.");
		}
		const root = this.element();
		this.misc();
		if (this.index < this.text.length) {
			throw new XmlError(this.index, "there is more after the root element.");
		}
		return root;
	}

	/** Whitespace, comments and processing instructions, before or after the root. */
	private misc(): void {
		for (;;) {
			this.space();
			if (this.text.startsWith("<!--", this.index)) this.skipPast("-->");
			else if (this.text.startsWith("<?", this.index)) this.skipPast("?>");
			else if (this.text.startsWith("<!DOCTYPE", this.index)) {
				throw new XmlError(this.index, "a DTD is not read.");
			} else return;
		}
	}

	private element(): XmlElement {
		this.index++;
		const name = this.name();
		const attributes = new Map<string, string>();
		for (;;) {
			const spaced = this.space();
			if (this.text.startsWith("/>", this.index)) {
				this.index += 2;
				return { name, attributes, children: [] };
			}
			if (this.text.startsWith(">", this.index)) {
				this.index++;
				return { name, attributes, children: this.content(name) };
			}
			if (!spaced)
				throw new XmlError(this.index, `the tag <${name}> is malformed.`);
			const attribute = this.name();
			if (attributes.has(attribute)) {
				throw new XmlError(this.index, `<${name}> has ${attribute} twice.`);
			}
			this.space();
			this.expect("=");
			this.space();
			attributes.set(attribute, this.attributeValue());
		}
	}

	/** The content of an element up to its end tag, which is read. */
	private content(name: string): XmlNode[] {
		const children: XmlNode[] = [];
		let text = "";
		const flush = () => {
			if (text !== "") children.push(text);
			text = "";
		};
		for (;;) {
			if (this.index >= this.text.length) {
				throw new XmlError(this.index, `<${name}> is never closed.`);
			}
			if (this.text.startsWith("</", this.index)) {
				this.index += 2;
				const end = this.name();
				this.space();
				this.expect(">");
				if (end !== name) {
					throw new XmlError(this.index, `</${end}> closes <${name}>.`);
				}
				flush();
				return children;
			}
			if (this.text.startsWith("<!--", this.index)) this.skipPast("-->");
			else if (this.text.startsWith("<![CDATA[", this.index)) {
				const start = this.index + 9;
				this.skipPast("]]>");
				text += this.text.slice(start, this.index - 3);
			} else if (this.text.startsWith("<?", this.index)) this.skipPast("?>");
			else if (this.text.startsWith("<", this.index)) {
				flush();
				children.push(this.element());
			} else text += this.characters();
		}
	}

	/** Text up to the next `<`, its references resolved. */
	private characters(): string {
		const end = this.text.indexOf("<", this.index);
		const stop = end === -1 ? this.text.length : end;
		const text = this.decoded(this.text.slice(this.index, stop), this.index);
		this.index = stop;
		return text;
	}

	private attributeValue(): string {
		const quote = this.text.charAt(this.index);
		if (quote !== '"' && quote !== "'") {
			throw new XmlError(this.index, "an attribute value must be quoted.");
		}
		const end = this.text.indexOf(quote, this.index + 1);
		if (end === -1)
			throw new XmlError(this.index, "an attribute value is never closed.");
		const raw = this.text.slice(this.index + 1, end);
		if (raw.includes("<"))
			throw new XmlError(this.index, "an attribute value holds <.");
		const value = this.decoded(
			raw.replaceAll(/[\t\n\r]/g, " "),
			this.index + 1,
		);
		this.index = end + 1;
		return value;
	}

	/** Text with its entity and character references resolved, each checked. */
	private decoded(raw: string, offset: number): string {
		if (!raw.includes("&")) return raw;
		return raw.replaceAll(
			/&([^;&]*);?/g,
			(written, reference: string, at: number) => {
				if (!written.endsWith(";")) {
					throw new XmlError(
						offset + at,
						"an & must start a reference, such as &amp;.",
					);
				}
				const named = ownEntry(entities, reference);
				if (named !== undefined) return named;
				const code = /^#x[0-9A-Fa-f]+$/.test(reference)
					? Number.parseInt(reference.slice(2), 16)
					: /^#\d+$/.test(reference)
						? Number.parseInt(reference.slice(1), 10)
						: undefined;
				if (code === undefined || !isXmlCharacter(code)) {
					throw new XmlError(
						offset + at,
						`${written} is not a reference grai reads.`,
					);
				}
				return String.fromCodePoint(code);
			},
		);
	}

	private name(): string {
		const start = this.index;
		if (!nameStart.test(this.text.charAt(this.index))) {
			throw new XmlError(this.index, "a name is expected here.");
		}
		while (nameCharacter.test(this.text.charAt(this.index))) this.index++;
		return this.text.slice(start, this.index);
	}

	private expect(text: string): void {
		if (!this.text.startsWith(text, this.index)) {
			throw new XmlError(this.index, `${text} is expected here.`);
		}
		this.index += text.length;
	}

	private skipPast(end: string): void {
		const at = this.text.indexOf(end, this.index);
		if (at === -1) throw new XmlError(this.index, `${end} is never reached.`);
		this.index = at + end.length;
	}

	/** Skips whitespace; whether there was any. */
	private space(): boolean {
		const start = this.index;
		while (/[ \t\r\n]/.test(this.text.charAt(this.index))) this.index++;
		return this.index > start;
	}
}
