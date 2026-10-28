import type { MigrateResult } from "../migrate.ts";
import { failed, parsed, sourceOption, sourcesOf } from "./command.ts";

/** `grai migrate`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config, values } = parsed(args, {
		...sourceOption,
		"default-namespace": { type: "string" },
	});
	// Loaded when it runs, as only this command reads another library's calls.
	const { migrate } = await import("../migrate.ts");
	const namespace = values["default-namespace"];
	const result = await migrate(config, sourcesOf(values), {
		defaultNamespace: typeof namespace === "string" ? namespace : undefined,
	});
	if (result.errors.length > 0) return failed(result.errors);
	for (const { file, line, column, detail } of result.left) {
		console.log(`${file}:${line}:${column}: ${detail}`);
	}
	console.log(summaryLine(result));
	return 0;
}

/** What a migration rewrote, and how many calls it left. */
function summaryLine({ rewritten, changed, left }: MigrateResult): string {
	const calls = `${rewritten} ${rewritten === 1 ? "call" : "calls"}`;
	const files = `${changed.length} ${changed.length === 1 ? "file" : "files"}`;
	const rest = left.length > 0 ? `, and left ${left.length}, listed above` : "";
	return `grai: rewrote ${calls} in ${files}${rest}`;
}
