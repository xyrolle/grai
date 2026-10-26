import { check } from "../check.ts";
import type { GraiError } from "../error.ts";
import { fixLines, removeUnusedKeys } from "../fix.ts";
import type { Unchecked } from "../missing-key-calls.ts";
import type { ScannedSources } from "../source-scan.ts";
import {
	type Command,
	failed,
	parsed,
	sourceOption,
	sourcesOf,
	UsageError,
} from "./command.ts";

export const checkCommand: Command = {
	usage: `  check [--source <dir>]... [--json]
                               report every problem and write nothing: what compile reports,
                               keys no shipped source names, inputs the locales do not agree on;
                               and the keys each locale has not translated yet
  check --fix [--source <dir>]...
                               remove the keys no shipped source can name from every catalog,
                               then check`,
	async run(args) {
		const { config, values } = parsed(args, {
			...sourceOption,
			json: { type: "boolean" },
			fix: { type: "boolean" },
		});
		const sources = sourcesOf(values);
		if (values.fix === true && values.json === true) {
			throw new UsageError("check takes --fix or --json, not both");
		}
		// A fix writes catalogs, the config and the descriptions, so the check after it takes the
		// sources the fix read, which it hands on unless it wrote one.
		let scanned: ScannedSources | undefined;
		if (values.fix === true) {
			const fixed = await removeUnusedKeys(config, sources);
			for (const line of fixLines(fixed)) console.log(line);
			if (fixed.errors.length > 0) return failed(fixed.errors);
			scanned = fixed.scanned;
		}
		const { problems, untranslated, unchecked } = await check(
			config,
			sources,
			scanned,
		);
		if (values.json === true) {
			console.log(
				JSON.stringify(
					checkedJson(problems, untranslated, unchecked),
					null,
					"\t",
				),
			);
			return problems.length > 0 ? 1 : 0;
		}
		for (const place of unchecked) console.log(uncheckedLine(place));
		for (const [locale, keys] of untranslated) {
			console.log(untranslatedLine(locale, keys));
		}
		if (problems.length > 0) return failed(problems);
		console.log("grai: no problems");
		return 0;
	},
};

/** Why check left a file's reads of a namespace out, and where. */
function uncheckedLine({ file, name, line, column, why }: Unchecked): string {
	if (why === "declared") {
		return `grai: not checked: ${file} declares ${name} again (${line}:${column}), so check cannot tell which of its ${name}.key reads are grai's.`;
	}
	const place = `${file}:${line}:${column}`;
	const reason =
		why === "jsx"
			? "may be JSX text, which check reads as JavaScript"
			: "follows a / that may start a regular expression or divide";
	return `grai: not checked: ${place} ${reason}, so it cannot tell whether its ${name} reads there are grai's.`;
}

/** How many keys of a locale are untranslated, and the first of them. */
function untranslatedLine(locale: string, keys: readonly string[]): string {
	const shownKeys = keys.slice(0, 10).join(", ");
	const more = keys.length > 10 ? `, and ${keys.length - 10} more` : "";
	return `grai: ${keys.length} untranslated in ${locale}: ${shownKeys}${more}`;
}

/**
 * A check's findings as JSON, for scripts: every problem, every untranslated key by locale, and
 * each file whose reads of a namespace it left out.
 */
function checkedJson(
	problems: readonly GraiError[],
	untranslated: ReadonlyMap<string, readonly string[]>,
	unchecked: readonly Unchecked[],
) {
	return {
		problems: problems.map(({ code, file, key, locale, message }) => ({
			code,
			file,
			key,
			locale,
			message,
		})),
		untranslated: Object.fromEntries(untranslated),
		unchecked,
	};
}
