#!/usr/bin/env node
import { relative, resolve } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { add } from "./add.ts";
import { check } from "./check.ts";
import { type CompileResult, compile } from "./compile.ts";
import { readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import {
	importCatalogs,
	importFormats,
	reportLines,
	summaryLine,
} from "./import.ts";
import { watch } from "./watch.ts";

const usage = `Usage: grai <command> [--config <file>]

  compile                      write the output, if the catalogs or config changed
  watch                        write it, then again on each change of a catalog or the config
  check [--source <dir>]...    report every problem and write nothing: what compile reports,
                               keys no source file names, inputs the locales do not agree on
  add <key> --<locale> <text>  with a text for each locale: add the key to every catalog,
                               then compile
  import --from i18next|icu <file or dir>...
                               convert another library's catalogs into new grai catalogs, and
                               report each message left out or rendered differently

The config is grai.config.json in the current directory, unless --config names another file.`;

/** Each command, given its arguments, does its work and returns the exit code. */
const commands: Record<string, (args: string[]) => Promise<number>> = {
	async compile(args) {
		const { config } = parsed(args);
		const started = performance.now();
		return reported(config, await compile(config), performance.now() - started);
	},
	async watch(args) {
		const { config } = parsed(args);
		console.log(`grai: watching ${shown(config)} and its catalogs`);
		let first = true;
		watch(
			config,
			(result, milliseconds) => {
				// A save can come as several events; the compiles after the first that change nothing say nothing.
				const quiet =
					!first && result.errors.length === 0 && result.written.length === 0;
				first = false;
				if (!quiet) reported(config, result, milliseconds);
			},
			// A compile that throws, as when the outdir cannot be written: the next save compiles again.
			(error) => console.error(error),
		);
		return 0;
	},
	async check(args) {
		const { config, values } = parsed(args, {
			source: { type: "string", multiple: true },
		});
		const sources = Array.isArray(values.source)
			? values.source.map((source) => resolve(String(source)))
			: undefined;
		const errors = await check(config, sources);
		if (errors.length > 0) return failed(errors);
		console.log("grai: no problems");
		return 0;
	},
	async add(args) {
		const { config } = parsed(args, {}, false);
		let locales: readonly string[];
		try {
			locales = readConfig(config).locales;
		} catch (error) {
			if (error instanceof GraiError) return failed([error]);
			throw error;
		}
		const flags: ParseArgsOptionsConfig = {};
		for (const locale of locales) flags[locale] = { type: "string" };
		const { values, positionals } = parsed(args, flags);
		const [key, ...others] = positionals;
		if (key === undefined || others.length > 0) {
			throw new UsageError(
				"add takes one key, and the key's text in each locale",
			);
		}
		const texts: Record<string, string> = {};
		for (const locale of locales) {
			const text = values[locale];
			if (typeof text === "string") texts[locale] = text;
		}
		const started = performance.now();
		return reported(
			config,
			await add(config, key, texts),
			performance.now() - started,
		);
	},
	async import(args) {
		const { config, values, positionals } = parsed(args, {
			from: { type: "string" },
		});
		const format = importFormats.find((name) => name === values.from);
		if (format === undefined || positionals.length === 0) {
			throw new UsageError(
				"import takes --from i18next or --from icu, and the files or directories to import",
			);
		}
		const result = importCatalogs(
			config,
			format,
			positionals.map((input) => resolve(input)),
		);
		for (const line of reportLines(result)) console.log(line);
		if (result.errors.length > 0) return failed(result.errors);
		console.log(summaryLine(result));
		return 0;
	},
};

class UsageError extends Error {}

/** What a command line gave: each option's value, by name. */
type Values = Readonly<
	Record<string, string | boolean | (string | boolean)[] | undefined>
>;

/** The config file, the command's options and its positionals. Unknown options are a usage error when strict. */
function parsed(
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

/** Prints what a compile wrote, or its errors; returns the exit code. */
function reported(
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
function failed(errors: readonly GraiError[]): number {
	for (const error of errors) console.error(error.message);
	console.error(
		`grai: ${errors.length} ${errors.length === 1 ? "error" : "errors"}`,
	);
	return 1;
}

function shown(path: string): string {
	return relative(process.cwd(), path) || ".";
}

const [name = "", ...args] = process.argv.slice(2);
const command = commands[name];
if (name === "--help" || name === "help") {
	console.log(usage);
} else if (command === undefined) {
	console.error(
		name === "" ? usage : `grai: there is no command "${name}"\n\n${usage}`,
	);
	process.exitCode = 2;
} else {
	try {
		process.exitCode = await command(args);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(`grai: ${error.message}\n\n${usage}`);
		process.exitCode = 2;
	}
}
