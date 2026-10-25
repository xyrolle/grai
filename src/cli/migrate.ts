import { mappingFile } from "../import.ts";
import type { MigrateResult } from "../migrate.ts";
import {
	type Command,
	failed,
	parsed,
	sourceOption,
	sourcesOf,
} from "./command.ts";

export const migrateCommand: Command = {
	usage: `  migrate [--source <dir>]... [--default-namespace <ns>]
                               rewrite each call of the imported library that names its message
                               plainly as a call of the grai message ${mappingFile} maps it to,
                               and report every other call, for a person to migrate`,
	async run(args) {
		const { config, values } = parsed(args, {
			...sourceOption,
			"default-namespace": { type: "string" },
		});
		const migrate = await loadMigrate();
		if (migrate === undefined) return 1;
		const namespace = values["default-namespace"];
		const result = migrate(config, sourcesOf(values), {
			defaultNamespace: typeof namespace === "string" ? namespace : undefined,
		});
		if (result.errors.length > 0) return failed(result.errors);
		for (const { file, line, column, detail } of result.left) {
			console.log(`${file}:${line}:${column}: ${detail}`);
		}
		console.log(summaryLine(result));
		return 0;
	},
};

/** What a migration rewrote, and how many calls it left. */
function summaryLine({ rewritten, changed, left }: MigrateResult): string {
	const calls = `${rewritten} ${rewritten === 1 ? "call" : "calls"}`;
	const files = `${changed.length} ${changed.length === 1 ? "file" : "files"}`;
	const rest = left.length > 0 ? `, and left ${left.length}, listed above` : "";
	return `grai: rewrote ${calls} in ${files}${rest}`;
}

/**
 * grai migrate, loaded when it runs: it parses sources with Vite's parser, which only this command
 * needs, so the others run in a project without Vite.
 */
async function loadMigrate() {
	try {
		return (await import("../migrate.ts")).migrate;
	} catch (error) {
		const missingVite =
			error instanceof Error &&
			"code" in error &&
			error.code === "ERR_MODULE_NOT_FOUND" &&
			error.message.includes("'vite'");
		if (!missingVite) throw error;
		console.error(
			"grai: migrate parses your sources with Vite's parser: add vite as a dev dependency while you migrate.",
		);
		return undefined;
	}
}
