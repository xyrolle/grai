import type { Plugin } from "vite";
import { type GraiOptions, graiPlugin } from "./vite-plugin.ts";

export type { GraiOptions };

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
