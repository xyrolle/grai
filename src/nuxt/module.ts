import { basename, resolve } from "node:path";
import {
	addPlugin,
	addServerHandler,
	addVitePlugin,
	createResolver,
	defineNuxtModule,
} from "nuxt/kit";
import type { NuxtModule } from "nuxt/schema";
import { baseDisagreement } from "../base-agreement.ts";
import { type CompileResult, recompile } from "../compile.ts";
import { readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { graiPlugin } from "../vite-plugin.ts";
import { localizedPages, sharedPath } from "./pages.ts";

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
 * every page is routed under each prefixed locale's prefix too, and a page asked for without the
 * prefix it needs is sent to its locale's path.
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
		const base = baseDisagreement(config, {
			option: "Nuxt's app.baseURL",
			base: nuxt.options.app.baseURL,
		});
		if (base !== undefined) {
			throw new GraiError(
				"config-invalid",
				{ file: basename(configFile) },
				base,
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
		// Nuxt's own base is checked against grai's above: Vite's is where Nuxt puts its assets.
		addVitePlugin(
			() => graiPlugin({ config: configFile, localeChunks: true }).plugin,
			{ server: false },
		);
		addServerHandler({
			middleware: true,
			handler: runtime("./runtime/locale"),
		});
		addPlugin(runtime("./runtime/plugin"));
		if (config.strategy.includes("url")) {
			nuxt.hook("pages:resolved", (pages) => {
				const { locales, baseLocale, urlRouting } = config;
				const shared = sharedPath(pages, locales, baseLocale, urlRouting);
				if (shared !== undefined) {
					const [owner, page] = shared.pages;
					throw new GraiError(
						"config-invalid",
						{ file: basename(configFile) },
						`Nuxt routes a page by its path alone, the same on every host, and "pathnames" gives ${shared.path} to ${page} in ${shared.locale}, where it is ${owner}'s path too. Give one of them other words.`,
					);
				}
				pages.push(...localizedPages(pages, locales, baseLocale, urlRouting));
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
