import { watch } from "../watch.ts";
import { parsed, reported, shown } from "./command.ts";

/** `grai watch`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config } = parsed(args);
	console.log(`grai: watching ${shown(config)} and its catalogs`);
	watch(
		config,
		(result, milliseconds) => reported(config, result, milliseconds),
		// A compile that throws, as when the outdir cannot be written: the next save compiles again.
		(error) => console.error(error),
	);
	return 0;
}
