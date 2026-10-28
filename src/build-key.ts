// What a saved build must match to be taken up again, apart from the compile that writes it: a
// module of its own, so that reading a saved build loads no compiler.
import { hash } from "node:crypto";
import { serialize } from "node:v8";
import type { CompileOptions } from "./compile.ts";
import { hashOfCompiler } from "./compiler-identity.ts";
import type { Config } from "./config.ts";

/**
 * What a saved build must match to be taken up again (`savedBuild`): the compiler and the runtime
 * that made it, the config as read, and the options it was compiled with. The runtime names V8, in
 * whose format the build is saved, and ICU, whose plural rules and locale data the compile reads.
 */
export function buildKey(
	config: Config,
	{ pseudoLocale = false, localeCopies = false }: CompileOptions,
): string {
	return JSON.stringify({
		compiler: hashOfCompiler(),
		runtime: [process.versions.v8, process.versions.icu],
		options: { pseudoLocale, localeCopies },
		config: hash("sha1", serialize(config)),
	});
}
