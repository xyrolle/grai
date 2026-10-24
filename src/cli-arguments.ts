import { resolve } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

/** A command line a command cannot read: the CLI prints it with the usage, and exits with 2. */
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
