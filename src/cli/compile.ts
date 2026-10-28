import { compile } from "../compile.ts";
import { parsed, reported } from "./command.ts";

/** `grai compile`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config } = parsed(args);
	const started = performance.now();
	return reported(config, await compile(config), performance.now() - started);
}
