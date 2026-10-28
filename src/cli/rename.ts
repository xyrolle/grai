import { rename } from "../rename.ts";
import {
	parsed,
	reported,
	sourceOption,
	sourcesOf,
	UsageError,
} from "./command.ts";

/** `grai rename`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config, values, positionals } = parsed(args, sourceOption);
	const [from, to, ...others] = positionals;
	if (from === undefined || to === undefined || others.length > 0) {
		throw new UsageError("rename takes the key and its new name");
	}
	const started = performance.now();
	const result = await rename(config, from, to, sourcesOf(values));
	if (result.changed.length > 0) {
		console.log(
			`grai: renamed ${from} to ${to} in ${result.changed.join(", ")}`,
		);
	}
	return reported(config, result, performance.now() - started);
}
