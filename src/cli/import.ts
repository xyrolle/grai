import { resolve } from "node:path";
import {
	importCatalogs,
	importFormats,
	mappingFile,
	reportLines,
	summaryLine,
} from "../import.ts";
import { failed, parsed, UsageError } from "./command.ts";

/** `grai import`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
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
	console.log(
		`grai: ${mappingFile} maps each key the source's calls name to its grai key, for grai migrate`,
	);
	return 0;
}
