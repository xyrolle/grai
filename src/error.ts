/** What went wrong, as a stable name a caller can branch on. */
export type GraiErrorCode =
	| "config-missing"
	| "config-unreadable"
	| "config-invalid"
	| "catalog-missing"
	| "catalog-unreadable"
	| "catalog-invalid"
	| "catalog-empty"
	| "catalog-exists"
	| "key-invalid"
	| "key-missing"
	| "key-exists"
	| "key-unused"
	| "inputs-differ"
	| "message-invalid"
	| "unsupported"
	| "plural-category-unknown"
	| "selection-not-exhaustive"
	| "output-locked";

/** Where a problem is: a file relative to the project's root, and the message's key and locale. */
export type GraiErrorWhere = {
	file: string;
	key?: string;
	locale?: string;
};

/** A compile failure, with its code and the file, key and locale it is about. */
export class GraiError extends Error {
	override readonly name = "GraiError";
	readonly code: GraiErrorCode;
	readonly file: string;
	readonly key: string | undefined;
	readonly locale: string | undefined;

	constructor(code: GraiErrorCode, where: GraiErrorWhere, detail: string) {
		super(`${location(where)}: ${detail}`);
		this.code = code;
		this.file = where.file;
		this.key = where.key;
		this.locale = where.locale;
	}
}

function location({ file, key, locale }: GraiErrorWhere): string {
	if (key === undefined) return file;
	return locale === undefined
		? `${file}: "${key}"`
		: `${file}: "${key}" (${locale})`;
}

/** Errors in reading order: by file, then key, then locale. */
export function sortErrors(errors: readonly GraiError[]): GraiError[] {
	return errors.toSorted(
		(a, b) =>
			compare(a.file, b.file) ||
			compare(a.key ?? "", b.key ?? "") ||
			compare(a.locale ?? "", b.locale ?? ""),
	);
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
