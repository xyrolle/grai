// What a saved build must match to be taken up again, apart from the compile that writes it: the
// compiler's identity, which hashes the runtime's sources the output copies, and the build's key.
// A module of its own, so that reading a saved build loads no compiler.
import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serialize } from "node:v8";
import { compilerIdentity } from "./compiler-identity.ts";
import type { Config } from "./config.ts";
import type { RuntimeSources } from "./output-modules.ts";

const text = (url: URL): string => readFileSync(url, "utf8");

/**
 * The runtime's modules, which every output carries, their imports of each other pinned, and the
 * templates of the output's declarations.
 */
export const runtimeSources: RuntimeSources = {
	runtime: text(new URL("./runtime/runtime.js", import.meta.url)),
	server: text(new URL("./runtime/server.js", import.meta.url)),
	testing: text(new URL("./runtime/testing.js", import.meta.url)),
	declarations: {
		runtime: text(new URL("./runtime/runtime.d.ts.template", import.meta.url)),
		server: text(new URL("./runtime/server.d.ts.template", import.meta.url)),
		testing: text(new URL("./runtime/testing.d.ts.template", import.meta.url)),
		setLocale: {
			live: text(
				new URL("./runtime/set-locale.live.d.ts.template", import.meta.url),
			),
			reload: text(
				new URL("./runtime/set-locale.reload.d.ts.template", import.meta.url),
			),
		},
	},
};

/**
 * The compiler's identity (`compilerIdentity`): what decides the output besides the config and the
 * catalogs. A new version of grai changes it, and so does a local build, which keeps its version,
 * so the output is written again after either. Taken on the first compile.
 */
let compilerHash: string | undefined;

export function hashOfCompiler(): string {
	compilerHash ??= compilerIdentity([
		runtimeSources.runtime,
		runtimeSources.server,
		runtimeSources.testing,
		runtimeSources.declarations.runtime,
		runtimeSources.declarations.server,
		runtimeSources.declarations.testing,
		runtimeSources.declarations.setLocale.live,
		runtimeSources.declarations.setLocale.reload,
	]);
	return compilerHash;
}

/**
 * What a saved build must match to be taken up again (`savedBuild`): the compiler and the runtime
 * that made it, the config as read, and the options it was compiled with. The runtime names V8, in
 * whose format the build is saved, and ICU, whose plural rules and locale data the compile reads.
 */
export function buildKey(
	config: Config,
	{
		pseudoLocale = false,
		localeCopies = false,
	}: { pseudoLocale?: boolean; localeCopies?: boolean },
): string {
	return JSON.stringify({
		compiler: hashOfCompiler(),
		runtime: [process.versions.v8, process.versions.icu],
		options: { pseudoLocale, localeCopies },
		config: hash("sha1", serialize(config)),
	});
}
