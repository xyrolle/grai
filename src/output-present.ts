/**
 * The output, compiled when it is missing, before a command reads code: the code's imports of it
 * resolve only once its modules are files, as they do for the app's own dev server and build.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { compile } from "./compile.ts";
import type { Config } from "./config.ts";
import type { GraiError } from "./error.ts";

/** Compiles the output if its messages.js or keys.js is missing; the compile's errors, if any. */
export async function compileOutputIfMissing(
	configFile: string,
	config: Config,
): Promise<readonly GraiError[]> {
	const present = ["messages.js", "keys.js"].every((module) =>
		existsSync(join(config.outdir, module)),
	);
	if (present) return [];
	return (await compile(configFile)).errors;
}
