import { ownEntry } from "../own-entry.ts";
import { MessageProblem } from "../problem.ts";
import { IcuPatternReader } from "./icu-pattern.ts";
import { invalid } from "./icu-scanner.ts";
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

/**
 * Reads an ICU message's arguments in braces: inputs, formatted values and choices, whose options
 * are patterns again.
 */
class IcuParser extends IcuPatternReader {
	/** `{name}`, or a choice: `{name, plural|select, options}`. */
	protected argument(): IcuNode {
		this.index++;
		const name = this.word();
		if (name === "") {
			throw invalid(
				"{ must be followed by a name, which holds no space, punctuation or symbol.",
			);
		}
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
		const style = this.take(",") ? this.style(name, kind) : "";
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

	/** The style after an argument's type and comma, which must name one. */
	private style(name: string, kind: string): string {
		const style = this.styleText();
		if (style === undefined) {
			throw invalid(
				`the style of {${name}, ${kind}} has a ' that no other ' closes.`,
			);
		}
		if (style === "") {
			throw invalid(
				`{${name}, ${kind},} must name a style after its comma, or have no comma.`,
			);
		}
		return style;
	}

	/** A choice's options up to its closing `}`, each a key and a message in braces. */
	private options(name: string, kind: ChoiceKind): IcuOption[] {
		const options: IcuOption[] = [];
		let key = this.key(name, kind);
		if (kind !== "select" && key === "offset") throw this.offset(name, kind);
		while (key !== "") {
			if (!this.take("{")) {
				throw invalid(
					`the key ${key} of {${name}, ${kind}} must be followed by its message in braces, and a key holds no space, punctuation or symbol.`,
				);
			}
			options.push({ key, nodes: this.nodes(kind !== "select", undefined) });
			if (!this.take("}")) {
				throw invalid(`the option ${key} of {${name}} must be closed by }.`);
			}
			key = this.key(name, kind);
		}
		if (!this.take("}")) {
			throw invalid(
				`each option of {${name}, ${kind}} must be a key and a message in braces.`,
			);
		}
		return options;
	}

	/** An option's key: an identifier, or a plural's `=` and whole number; empty if none is there. */
	private key(name: string, kind: ChoiceKind): string {
		const key = this.word();
		if (key !== "" || kind === "select" || !this.take("=")) return key;
		const exact = this.wholeNumber();
		if (exact === undefined) {
			throw invalid(
				`an = in {${name}, ${kind}} must be followed by ${wholeNumberNote}, as in =0.`,
			);
		}
		return `=${exact}`;
	}

	/** Why a plural's `offset:n`, which ICU reads before its keys, is left out. */
	private offset(name: string, kind: ChoiceKind): MessageProblem {
		const offset = this.offsetValue();
		if (offset === undefined) {
			return invalid(
				`offset in {${name}, ${kind}} must be followed by : and ${wholeNumberNote}, as in offset:1.`,
			);
		}
		return new MessageProblem(
			"unsupported",
			`{${name}, ${kind}, offset:${offset}} subtracts an offset from the count, which grai does not support.`,
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

/** The numbers ICU takes after `=` and `offset:`, as intl-messageformat reads them. */
const wholeNumberNote = "a whole number that JavaScript holds exactly";

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
