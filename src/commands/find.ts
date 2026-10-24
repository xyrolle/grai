import { find, foundLines } from "../find.ts";
import {
	type Command,
	parsed,
	sourceOption,
	sourcesOf,
	UsageError,
} from "./arguments.ts";
import { failed } from "./output.ts";

export const findCommand: Command = {
	usage: `  find <key> [--source <dir>]...
                               print the key's line in each catalog, and each call site`,
	async run(args) {
		const { config, values, positionals } = parsed(args, sourceOption);
		const [key, ...others] = positionals;
		if (key === undefined || others.length > 0) {
			throw new UsageError("find takes one key");
		}
		const found = await find(config, key, sourcesOf(values));
		for (const line of foundLines(key, found)) console.log(line);
		return found.errors.length > 0 ? failed(found.errors) : 0;
	},
};
