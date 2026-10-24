import { watch } from "../watch.ts";
import { type Command, parsed } from "./arguments.ts";
import { reported, shown } from "./output.ts";

export const watchCommand: Command = {
	usage:
		"  watch                        write it, then again on each change of a catalog or the config",
	async run(args) {
		const { config } = parsed(args);
		console.log(`grai: watching ${shown(config)} and its catalogs`);
		let first = true;
		watch(
			config,
			(result, milliseconds) => {
				// A save can come as several events; the compiles after the first that change nothing say nothing.
				const quiet =
					!first && result.errors.length === 0 && result.written.length === 0;
				first = false;
				if (!quiet) reported(config, result, milliseconds);
			},
			// A compile that throws, as when the outdir cannot be written: the next save compiles again.
			(error) => console.error(error),
		);
		return 0;
	},
};
