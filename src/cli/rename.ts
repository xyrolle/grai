import { rename } from "../rename.ts";
import {
	type Command,
	parsed,
	reported,
	sourceOption,
	sourcesOf,
	UsageError,
} from "./command.ts";

export const renameCommand: Command = {
	usage: `  rename <key> <new> [--source <dir>]...
                               rename the key in every catalog and at every call site, then
                               compile; nothing changes if a call site is unclear`,
	async run(args) {
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
	},
};
