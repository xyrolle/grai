import { MessageProblem } from "../problem.ts";

/**
 * Reads an ICU message's tokens, from where its parser has got to: its words, and the spaces
 * between them.
 */
export class IcuScanner {
	protected readonly source: string;
	protected index = 0;

	constructor(source: string) {
		this.source = source;
	}

	/** Skips spaces, then reads up to a space, `,`, `{` or `}`. */
	protected word(): string {
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

	protected take(char: string): boolean {
		this.space();
		if (this.source.charAt(this.index) !== char) return false;
		this.index++;
		return true;
	}

	protected space(): void {
		while (/\s/.test(this.source.charAt(this.index))) this.index++;
	}
}

/** A message ICU's grammar does not allow, with what is wrong with it. */
export function invalid(detail: string): MessageProblem {
	return new MessageProblem(
		"message-invalid",
		`it is not a valid ICU message: ${detail}`,
	);
}
