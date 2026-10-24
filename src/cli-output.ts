import { relative } from "node:path";
import type { CompileResult } from "./compile.ts";
import { readConfig } from "./config.ts";
import type { GraiError } from "./error.ts";

/** Prints what a compile wrote, or its errors; returns the exit code. */
export function reported(
	config: string,
	result: CompileResult,
	milliseconds: number,
): number {
	if (result.errors.length > 0) return failed(result.errors);
	const time = `${milliseconds.toFixed(milliseconds < 10 ? 1 : 0)} ms`;
	const outdir = shown(readConfig(config).outdir);
	const files =
		result.written.length === 1
			? result.written[0]
			: `${result.written.length} files`;
	console.log(
		result.written.length === 0
			? `grai: ${outdir} is up to date (${time})`
			: `grai: wrote ${files} in ${outdir} (${time})`,
	);
	return 0;
}

/** Prints every error, in the order given, and how many; returns the exit code. */
export function failed(errors: readonly GraiError[]): number {
	for (const error of errors) console.error(error.message);
	console.error(
		`grai: ${errors.length} ${errors.length === 1 ? "error" : "errors"}`,
	);
	return 1;
}

/** A path as the command line shows it: relative to the current directory. */
export function shown(path: string): string {
	return relative(process.cwd(), path) || ".";
}
