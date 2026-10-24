/**
 * Markup as MessageFormat 2 writes it: `{#name}` opens, `{/name}` closes and `{#name/}` stands
 * alone, each with options (`href=|/terms|`, `id=$input`) and attributes (`@translate=no`, `@hidden`)
 * after its name.
 */

import { MessageProblem } from "./problem.ts";

/** An option's value: a literal, or the value of an input or local. */
export type MarkupValue = { literal: string } | { variable: string };

export type MarkupPart = {
	type: "markup-start" | "markup-end" | "markup-standalone";
	name: string;
	options: ReadonlyMap<string, MarkupValue>;
	/** Each attribute's literal, or true for one written without a value. */
	attributes: ReadonlyMap<string, string | true>;
};

/** The inputs or locals a markup's options take their values from. */
export function markupVariables(part: MarkupPart): string[] {
	return [...part.options.values()].flatMap((value) =>
		"variable" in value ? [value.variable] : [],
	);
}

const markup = /^([#/])([^\s/=@|$]+)(.*?)(\/?)$/s;

/** The markup a placeholder's body writes, or undefined when it is not markup. */
export function parseMarkup(body: string): MarkupPart | undefined {
	const [, sigil, name = "", rest = "", slash] = markup.exec(body) ?? [];
	if (sigil === undefined) return undefined;
	if (sigil === "/" && slash === "/") {
		throw invalid(body, "a closing tag cannot also stand alone");
	}
	const { options, attributes } = new MarkupReader(body, rest).read();
	const type =
		sigil === "/"
			? "markup-end"
			: slash === "/"
				? "markup-standalone"
				: "markup-start";
	return { type, name, options, attributes };
}

const settingName = /^[A-Za-z_][\w.-]*/;
const variable = /^\$([A-Za-z_$][\w$]*)/;
const unquoted = /^[^\s/=@|]+/;

/** Reads a markup's options and attributes from the text after its name. */
class MarkupReader {
	readonly options = new Map<string, MarkupValue>();
	readonly attributes = new Map<string, string | true>();
	private readonly body: string;
	private rest: string;

	constructor(body: string, rest: string) {
		this.body = body;
		this.rest = rest;
	}

	read(): this {
		while (this.rest.trim() !== "") {
			if (!/^\s/.test(this.rest)) {
				throw invalid(
					this.body,
					"write a space before each option and attribute",
				);
			}
			this.rest = this.rest.trimStart();
			if (this.take("@")) this.attribute();
			else this.option();
		}
		return this;
	}

	private option(): void {
		const key = this.name(this.options);
		if (!this.equals()) {
			throw invalid(
				this.body,
				`the option ${key} needs a value, such as ${key}=|text|`,
			);
		}
		this.options.set(key, this.value());
	}

	private attribute(): void {
		const key = this.name(this.attributes);
		if (!this.equals()) {
			this.attributes.set(key, true);
			return;
		}
		const value = this.value();
		if ("variable" in value) {
			throw invalid(
				this.body,
				`the attribute @${key} takes a literal, not an input`,
			);
		}
		this.attributes.set(key, value.literal);
	}

	/** An option's or attribute's name, which it must not already have. */
	private name(given: ReadonlyMap<string, unknown>): string {
		const [key = ""] = settingName.exec(this.rest) ?? [];
		if (key === "")
			throw invalid(
				this.body,
				`"${this.rest}" is not an option or an attribute`,
			);
		if (given.has(key)) throw invalid(this.body, `${key} is given twice`);
		this.rest = this.rest.slice(key.length);
		return key;
	}

	private equals(): boolean {
		const equals = /^\s*=\s*/.exec(this.rest);
		if (equals === null) return false;
		this.rest = this.rest.slice(equals[0].length);
		return true;
	}

	/** A value: `|quoted|`, with `\` escaping the next character, `$input`, or an unquoted word. */
	private value(): MarkupValue {
		if (this.take("|")) return { literal: this.quoted() };
		const input = variable.exec(this.rest);
		if (input?.[1] !== undefined) {
			this.rest = this.rest.slice(input[0].length);
			return { variable: input[1] };
		}
		const [literal = ""] = unquoted.exec(this.rest) ?? [];
		if (literal === "")
			throw invalid(this.body, `"${this.rest}" is not a value`);
		this.rest = this.rest.slice(literal.length);
		return { literal };
	}

	private quoted(): string {
		let literal = "";
		for (let index = 0; index < this.rest.length; index++) {
			const char = this.rest.charAt(index);
			if (char === "|") {
				this.rest = this.rest.slice(index + 1);
				return literal;
			}
			if (char === "\\") index++;
			literal += this.rest.charAt(index);
		}
		throw invalid(this.body, "a quoted value is not closed by |");
	}

	private take(char: string): boolean {
		if (!this.rest.startsWith(char)) return false;
		this.rest = this.rest.slice(char.length);
		return true;
	}
}

function invalid(body: string, detail: string): MessageProblem {
	return new MessageProblem(
		"message-invalid",
		`the markup {${body}}: ${detail}.`,
	);
}
