/** What every command of the CLI shares: reading its arguments, and printing what it did. */

import { relative, resolve } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import type { CompileResult } from "../compile.ts";
import { readConfig } from "../config.ts";
import type { GraiError } from "../error.ts";

/** A command: its lines of the usage, and what it does with its arguments, returning the exit code. */
export type Command = {
	usage: string;
	run: (args: string[]) => Promise<number>;
};

/** A command line the command cannot take; the CLI prints it with the usage and exits with 2. */
export class UsageError extends Error {}

/** What a command line gave: each option's value, by name. */
export type Values = Readonly<
	Record<string, string | boolean | (string | boolean)[] | undefined>
>;

/** `--source <dir>`, as often as needed: where the source files are, instead of the project's root. */
export const sourceOption: ParseArgsOptionsConfig = {
	source: { type: "string", multiple: true },
};

/** The config file, the command's options and its positionals. Unknown options are a usage error when strict. */
export function parsed(
	args: string[],
	own: ParseArgsOptionsConfig = {},
	strict = true,
): { config: string; values: Values; positionals: string[] } {
	try {
		const { values, positionals } = parseArgs({
			args,
			options: { config: { type: "string" }, ...own },
			allowPositionals: true,
			strict,
		});
		const config =
			typeof values.config === "string" ? values.config : "grai.config.json";
		return { config: resolve(config), values, positionals };
	} catch (error) {
		if (
			error instanceof TypeError &&
			"code" in error &&
			String(error.code).startsWith("ERR_PARSE_ARGS")
		) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

/** The directories `--source` names, resolved, or undefined for the project's root. */
export function sourcesOf(values: Values): string[] | undefined {
	return Array.isArray(values.source)
		? values.source.map((source) => resolve(String(source)))
		: undefined;
}

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

/** A path as the CLI prints it: from the current directory. */
export function shown(path: string): string {
	return relative(process.cwd(), path) || ".";
}
