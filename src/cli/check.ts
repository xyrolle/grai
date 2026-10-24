import { check } from "../check.ts";
import type { GraiError } from "../error.ts";
import {
	type Command,
	failed,
	parsed,
	sourceOption,
	sourcesOf,
} from "./command.ts";

export const checkCommand: Command = {
	usage: `  check [--source <dir>]... [--json]
                               report every problem and write nothing: what compile reports,
                               keys no source file names, inputs the locales do not agree on;
                               and the keys each locale has not translated yet`,
	async run(args) {
		const { config, values } = parsed(args, {
			...sourceOption,
			json: { type: "boolean" },
		});
		const sources = sourcesOf(values);
		const { problems, untranslated } = await check(config, sources);
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
