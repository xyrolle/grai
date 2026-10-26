import type { GraiError } from "../error.ts";

/** Prints each error a compile found, then their count. */
export function reportErrors(errors: readonly GraiError[]): void {
	if (errors.length === 0) return;
	for (const error of errors) console.error(error.message);
	console.error(`grai: ${count(errors)}`);
}

/** How many errors there are, in words: `1 error`, `2 errors`. */
export function count(errors: readonly GraiError[]): string {
	return `${errors.length} ${errors.length === 1 ? "error" : "errors"}`;
}
