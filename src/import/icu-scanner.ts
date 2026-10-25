import { MessageProblem } from "../problem.ts";

/** What ICU skips between the parts of an argument: Unicode's Pattern_White_Space. */
const space = /\p{Pattern_White_Space}*/uy;
/** An ICU identifier, which names an input, a type or a key: no white space or pattern syntax. */
const identifier = /[^\p{White_Space}\p{Pattern_Syntax}]*/uy;
/** A whole number as ICU writes an offset or an exact key's: a sign, then digits. */
const wholeNumber = /[+-]?\d+/y;

/**
 * Reads an ICU message's tokens as intl-messageformat reads them, from where the parser has got
 * to: its identifiers, numbers and styles, and the spaces between them.
 */
export class IcuScanner {
	protected readonly source: string;
	protected index = 0;

	constructor(source: string) {
		this.source = source;
	}

	/** Skips spaces, then reads an identifier, which is empty when none is there. */
	protected word(): string {
		this.space();
		return this.read(identifier);
	}

	/** Reads a whole number, if one that a JavaScript number holds exactly is there. */
	protected wholeNumber(): string | undefined {
		const number = this.read(wholeNumber);
		return number !== "" && Number.isSafeInteger(Number(number))
			? number
			: undefined;
	}

	/** Reads the `:` that comes right after `offset`, then spaces and a whole number, if both are. */
	protected offsetValue(): string | undefined {
		if (this.source.charAt(this.index) !== ":") return undefined;
		this.index++;
		this.space();
		return this.wholeNumber();
	}

	/**
	 * Skips spaces, then reads a style as intl-messageformat does: up to the first `}` outside
	 * quoted text, without the spaces at its end. It is undefined when a `'` opens a quote that no
	 * other closes.
	 */
	protected styleText(): string | undefined {
		this.space();
		const start = this.index;
		while (
			this.index < this.source.length &&
			this.source.charAt(this.index) !== "}"
		) {
			if (this.source.charAt(this.index) === "'") {
				const close = this.source.indexOf("'", this.index + 1);
				if (close === -1) return undefined;
				this.index = close;
			}
			this.index++;
		}
		return this.source.slice(start, this.index).trimEnd();
	}

	protected take(char: string): boolean {
		this.space();
		if (this.source.charAt(this.index) !== char) return false;
		this.index++;
		return true;
	}

	protected space(): void {
		this.read(space);
	}

	/** Reads what the sticky pattern matches at the index, which may be nothing. */
	private read(pattern: RegExp): string {
		pattern.lastIndex = this.index;
		const [match = ""] = pattern.exec(this.source) ?? [];
		this.index += match.length;
		return match;
	}
}

/** A message ICU's grammar does not allow, with what is wrong with it. */
export function invalid(detail: string): MessageProblem {
	return new MessageProblem(
		"message-invalid",
		`it is not a valid ICU message: ${detail}`,
	);
}
