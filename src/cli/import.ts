import { resolve } from "node:path";
import {
	importCatalogs,
	importFormats,
	reportLines,
	summaryLine,
} from "../import.ts";
import { type Command, failed, parsed, UsageError } from "./command.ts";

export const importCommand: Command = {
	usage: `  import --from i18next|icu <file or dir>...
                               convert another library's catalogs into new grai catalogs, and
                               report each message left out or rendered differently`,
	async run(args) {
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
