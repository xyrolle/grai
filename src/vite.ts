import { resolve } from "node:path";
import type { Plugin } from "vite";
import { readConfig } from "./config.ts";
import { type GraiModuleKind, moduleKindIn } from "./vite-build.ts";
import { type GraiOptions, graiPlugin } from "./vite-plugin.ts";

export type { GraiModuleKind, GraiOptions };

/**
 * grai's Vite plugin. In dev it compiles the catalogs when the server starts and whenever one
 * of them or the config changes, and nothing else; it serves every message as one module from
 * memory, and an edit sends only the changed keys' functions, which the page writes in place
 * (`vite-dev.ts`, `dev-module.ts`). In a build, every key is a module of its own, so each chunk
 * holds only the keys its code uses; in the client build those modules go to chunks of their
 * own, under a `grai/` within the chunks' directory, and each locale gets a copy of each under
 * `grai-<locale>/` beside it, with the same names and only its own words (`vite-build.ts`,
 * `locale-chunks.ts`).
 */
export function grai(options: GraiOptions = {}): Plugin {
	return graiPlugin(options).plugin;
}

/**
 * For a tool that reads a client build's chunks, so it need not spell grai's module ids: the kind
 * of the module of grai's an id is, or `undefined` for any other module. `runtime`, `config`,
 * `plurals` and `formats` go to the `grai-runtime` chunk, and `key` and `text` to the message
 * chunks under `grai/`. Ids are as the bundler gives them. `config` is the path of the project's
 * grai.config.json, from the working directory.
 */
export function graiModules(
	options: GraiOptions = {},
): (id: string) => GraiModuleKind | undefined {
	return moduleKindIn(
		readConfig(resolve(options.config ?? "grai.config.json")).outdir,
	);
}
