import { check } from "../check.ts";
import type { ProjectCode } from "../code/project.ts";
import type { GraiError } from "../error.ts";
import { fixLines, removeUnusedKeys } from "../fix.ts";
import {
	importKeysByPath,
	keysImports,
	movedLines,
} from "../key-path-imports.ts";
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
                               import each key from its own path where an import takes it from
                               keys.js, then check`,
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
		// Removing keys writes catalogs, the config and the descriptions, none of them code, so the
		// check after it takes the code the fix read, unless the fix moved an import.
		let code: ProjectCode | undefined;
		if (values.fix === true) {
			const fixed = await removeUnusedKeys(config, sources);
			for (const line of fixLines(fixed)) console.log(line);
			if (fixed.errors.length > 0) return failed(fixed.errors);
			if (fixed.code !== undefined && fixed.reading !== undefined) {
				const found = await keysImports(fixed.code, fixed.reading);
				const moved = await importKeysByPath(found);
				for (const line of movedLines(moved)) console.log(line);
				code = moved.length > 0 ? undefined : fixed.code;
			}
		}
		const { problems, untranslated } = await check(config, sources, code);
		if (values.json === true) {
			console.log(
				JSON.stringify(checkedJson(problems, untranslated), null, "\t"),
			);
			return problems.length > 0 ? 1 : 0;
		}
		for (const [locale, keys] of untranslated) {
			console.log(untranslatedLine(locale, keys));
		}
		if (problems.length > 0) return failed(problems);
		console.log("grai: no problems");
		return 0;
	},
};

/** How many keys of a locale are untranslated, and the first of them. */
function untranslatedLine(locale: string, keys: readonly string[]): string {
	const shownKeys = keys.slice(0, 10).join(", ");
	const more = keys.length > 10 ? `, and ${keys.length - 10} more` : "";
	return `grai: ${keys.length} untranslated in ${locale}: ${shownKeys}${more}`;
}

/** A check's findings as JSON, for scripts: every problem, and every untranslated key by locale. */
function checkedJson(
	problems: readonly GraiError[],
	untranslated: ReadonlyMap<string, readonly string[]>,
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
	};
}
