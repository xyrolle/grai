/**
 * The output, compiled when it is missing or was written without its declarations, before a command
 * reads code: the code's imports of it resolve only once its modules are files, as they do for the
 * app's own dev server and build, and the code type-checks against it only once its declarations
 * are, which a dev server stopped before it wrote them left out.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { compile } from "./compile.ts";
import type { Config } from "./config.ts";
import type { GraiError } from "./error.ts";
import { readManifest } from "./manifest.ts";
import { stateDirectory } from "./state-directory.ts";

/**
 * Compiles the output if its messages.js or keys.js is missing, or its manifest records it as
 * written without its declarations (`writeUndeclared`): declarations an earlier output left may
 * still be there, but not this output's. The compile's errors, if any.
 */
export async function compileOutputIfMissing(
	configFile: string,
	config: Config,
): Promise<readonly GraiError[]> {
	const present = ["messages.js", "keys.js"].every((module) =>
		existsSync(join(config.outdir, module)),
	);
	const manifest = present
		? await readManifest(join(config.outdir, stateDirectory))
		: undefined;
	if (present && manifest?.undeclared === undefined) return [];
	return (await compile(configFile)).errors;
}
