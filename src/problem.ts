import type { GraiErrorCode } from "./error.ts";

/** A problem in one message, before it is placed in its file, key and locale. */
export class MessageProblem extends Error {
	readonly code: GraiErrorCode;

	constructor(code: GraiErrorCode, detail: string) {
		super(detail);
		this.code = code;
	}
}
