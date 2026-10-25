import { watch } from "../watch.ts";
import { type Command, parsed, reported, shown } from "./command.ts";

export const watchCommand: Command = {
	usage:
		"  watch                        write it, then again on each change of a catalog or the config",
	async run(args) {
		const { config } = parsed(args);
		console.log(`grai: watching ${shown(config)} and its catalogs`);
		watch(
			config,
			(result, milliseconds) => reported(config, result, milliseconds),
			// A compile that throws, as when the outdir cannot be written: the next save compiles again.
			(error) => console.error(error),
		);
		return 0;
	},
};
