import { resolve } from "node:path";
import { mergeDocument } from "../translations.ts";
import { failed, parsed, reported, UsageError } from "./command.ts";

/** `grai merge`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config, positionals } = parsed(args);
	const [file, ...others] = positionals;
	if (file === undefined || others.length > 0) {
		throw new UsageError("merge takes one file");
	}
	const started = performance.now();
	const merged = await mergeDocument(config, resolve(file));
	if ("errors" in merged) return failed(merged.errors);
	console.log(
		merged.messages === 0
			? `grai: the file changes no message of ${merged.files.join(", ")}`
			: `grai: merged ${merged.units} ${merged.units === 1 ? "unit" : "units"} into ${merged.messages} ${merged.messages === 1 ? "message" : "messages"} of ${merged.files.join(", ")}`,
	);
	const code = reported(config, merged.result, performance.now() - started);
	return merged.refused.length > 0 ? failed(merged.refused) : code;
}
