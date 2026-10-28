import { find, foundLines } from "../find.ts";
import {
	failed,
	parsed,
	sourceOption,
	sourcesOf,
	UsageError,
} from "./command.ts";

/** `grai find`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config, values, positionals } = parsed(args, sourceOption);
	const [key, ...others] = positionals;
	if (key === undefined || others.length > 0) {
		throw new UsageError("find takes one key");
	}
	const found = await find(config, key, sourcesOf(values));
	for (const line of foundLines(key, found)) console.log(line);
	return found.errors.length > 0 ? failed(found.errors) : 0;
}
