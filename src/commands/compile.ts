import { compile } from "../compile.ts";
import { type Command, parsed } from "./arguments.ts";
import { reported } from "./output.ts";

export const compileCommand: Command = {
	usage:
		"  compile                      write the output, if the catalogs or config changed",
	async run(args) {
		const { config } = parsed(args);
		const started = performance.now();
		return reported(config, await compile(config), performance.now() - started);
	},
};
