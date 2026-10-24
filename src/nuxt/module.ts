import { resolve } from "node:path";
import {
	addPlugin,
	addServerHandler,
	addVitePlugin,
	createResolver,
	defineNuxtModule,
} from "nuxt/kit";
import type { NuxtModule } from "nuxt/schema";
import { type CompileResult, recompile } from "../compile.ts";
import { readConfig } from "../config.ts";
import { grai } from "../vite.ts";
import { localizedPages } from "./pages.ts";

/** The module's options. `config` is the path of the project's grai.config.json, from its root. */
export type GraiNuxtOptions = { config: string };

/** The name grai/nuxt's runtime imports the project's compiled output by, in the app and the server. */
const output = "grai/nuxt/output";

/**
 * grai's Nuxt module, with grai.config.json in the project's root:
 *
 *     export default defineNuxtConfig({ modules: ["grai/nuxt"] });
 *
 * It compiles the catalogs before Nuxt builds anything, and grai/vite compiles again on each
 * edit in dev. A server middleware resolves each request's locale by the config's strategy, the
 * render binds it, and the page's `<html>` takes it with its direction. With the `url` strategy,
 * every page is routed under each locale's prefix too.
 */
const module: NuxtModule<GraiNuxtOptions> = defineNuxtModule<GraiNuxtOptions>({
	meta: { name: "grai", configKey: "grai" },
	defaults: { config: "grai.config.json" },
	async setup(options, nuxt) {
		const configFile = resolve(nuxt.options.rootDir, options.config);
		const config = readConfig(configFile);
		if (!nuxt.options.ssr) {
			throw new Error(
				"grai: grai/nuxt renders each page in its request's locale on the server, and Nuxt's ssr is off. Turn it on.",
			);
		}
		if (config.strategy.includes("url") && nuxt.options.app.baseURL !== "/") {
			throw new Error(
				`grai: the url strategy reads a locale from a path's first segment, and Nuxt's app.baseURL is ${nuxt.options.app.baseURL}. Serve the app from /, or use another strategy.`,
			);
		}
		// As grai/vite's compile, so that the output it finds is already the one it would write.
		const { result } = await recompile(configFile, undefined, {
			localeCopies: true,
		});
		reported(result, nuxt.options.dev);

		const runtime = createResolver(import.meta.url).resolve;
		nuxt.options.alias[output] = config.outdir;
		// Only the browser's build: Nuxt runs the server's dev modules in a runner of its own,
		// which takes an edit when the output's files change, not through grai/vite's patch. A
		// build writes each message chunk's copy per locale, which a page then loads alone.
		addVitePlugin(() => grai({ config: configFile, localeChunks: true }), {
			server: false,
		});
		addServerHandler({
			middleware: true,
			handler: runtime("./runtime/locale"),
		});
		addPlugin(runtime("./runtime/plugin"));
		if (config.strategy.includes("url")) {
			nuxt.hook("pages:resolved", (pages) => {
				pages.push(...localizedPages(pages, config.locales, config.baseLocale));
			});
		}
	},
});
export default module;

/** Prints a compile's errors; a build fails on them, and dev goes on, to show the next compile's. */
function reported(result: CompileResult, dev: boolean): void {
	if (result.errors.length === 0) return;
	for (const error of result.errors) console.error(error.message);
	const count = `${result.errors.length} ${result.errors.length === 1 ? "error" : "errors"}`;
	if (!dev)
		throw new Error(`grai: the catalogs did not compile, with ${count}.`);
	console.error(`grai: ${count}`);
}
