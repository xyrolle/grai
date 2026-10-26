import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AstroConfig,
	AstroIntegration,
	IntegrationResolvedRoute,
} from "astro";
import type { Plugin, ViteDevServer } from "vite";
import { disagreements } from "./astro/agreement.ts";
import type { LocaleProject } from "./astro/middleware.ts";
import {
	translatablePages,
	translatedPage,
	translatedPathsId,
	translatedPathsModule,
	translatedPatterns,
} from "./astro/translated-routes.ts";
import { compile } from "./compile.ts";
import { type Config, readConfig, type Strategy } from "./config.ts";
import { GraiError, messagesOf } from "./error.ts";
import { localeDirectory, messageDirectory } from "./message-directories.ts";
import { graiPlugin } from "./vite-plugin.ts";

/** The integration's options. `config` is the path of the project's grai.config.json, from Astro's root. */
export type GraiAstroOptions = { config?: string };

/** The middleware the integration adds: a module of the project's own, which it writes. */
const middlewareId = "grai:astro/middleware";

/**
 * grai's Astro integration:
 * - it adds `grai/vite`, so `astro dev` compiles the catalogs and reloads the open pages after
 *   each edit, and `astro build` compiles them and fails on any error; `astro sync`, which
 *   `astro check` runs, compiles them for their types;
 * - it checks, once Astro's config is done, that the two configs agree on where a page's locale
 *   comes from (`astro/agreement.ts`);
 * - it adds the middleware that renders each request in its locale (`astro/middleware.ts`), ahead
 *   of the app's own;
 * - it adds a prerendered route for each path in a locale's words that `pathnames` gives, so a
 *   static build writes each page there too (`astro/translated-routes.ts`);
 * - in a build, it lists each locale's import map by its hash in Astro's CSP, where the app has one.
 */
export function grai(options: GraiAstroOptions = {}): AstroIntegration {
	let configFile = "";
	let building = false;
	let middleware: string | undefined;
	let astro: AstroConfig | undefined;
	let translatable: IntegrationResolvedRoute[] = [];
	// The project's grai config, read when a hook first needs it, after the first has named it.
	let read: Config | undefined;
	const graiConfig = () => {
		read ??= readConfig(configFile);
		return read;
	};
	const modules = virtualModules({
		[middlewareId]: () => middleware,
		[translatedPathsId]: () =>
			astro && translatedPathsModule(translatable, graiConfig(), astro),
	});
	// Where the import maps hashed into Astro's CSP point, which the build must serve the chunks at.
	let hashedChunks: string | undefined;
	return {
		name: "grai",
		hooks: {
			"astro:config:setup": async ({
				config,
				command,
				updateConfig,
				addMiddleware,
				injectRoute,
				createCodegenDir,
			}) => {
				configFile = resolve(
					fileURLToPath(config.root),
					options.config ?? "grai.config.json",
				);
				building = command === "build";
				if (command === "sync") {
					const { errors } = await compile(configFile);
					if (errors.length > 0) throw new Error(messagesOf(errors));
				}
				updateConfig({
					vite: {
						plugins: [
							// Astro's own base is checked against grai's beside its i18n routing (`agreement.ts`).
							...graiPlugin({
								config: configFile,
								reloadOnEdit: true,
								localeChunks: true,
							}).plugins,
							modules.plugin,
						],
					},
				});
				addMiddleware({ order: "pre", entrypoint: middlewareId });
				const grai = graiConfig();
				const patterns = grai.strategy.includes("url")
					? translatedPatterns(grai)
					: [];
				if (patterns.length > 0) {
					const page = new URL("translated.astro", createCodegenDir());
					written(page, translatedPage);
					for (const pattern of patterns) {
						injectRoute({ pattern, entrypoint: page, prerender: true });
					}
				}
				const algorithm = cspAlgorithm(config);
				if (building && algorithm !== undefined) {
					// Astro's CSP lets an inline script through by a hash its config lists for every
					// page: the middleware's import map is written after Astro has drawn the policy.
					hashedChunks = chunksUrl(config);
					const { locales } = graiConfig();
					const maps = Object.values(importMaps(locales, hashedChunks));
					updateConfig({
						security: {
							csp: {
								algorithm,
								scriptDirective: { hashes: maps.map(scriptHash) },
							},
						},
					});
				}
			},
			"astro:config:done": ({ config }) => {
				astro = config;
				const grai = graiConfig();
				const problems = disagreements(grai, config);
				if (problems.length > 0) {
					throw new GraiError(
						"config-invalid",
						{ file: basename(configFile) },
						`grai's config and Astro's disagree.\n${problems.join("\n")}`,
					);
				}
				const chunks = chunksUrl(config);
				if (hashedChunks !== undefined && hashedChunks !== chunks) {
					throw new GraiError(
						"config-invalid",
						{ file: basename(configFile) },
						`Astro's CSP lets each page's import map through by its hash, which grai took when its integration was set up, for chunks at ${hashedChunks}, but the build serves them at ${chunks}: an integration after grai's changed Astro's base or build.assets. List grai() after it in "integrations".`,
					);
				}
				const maps = importMaps(grai.locales, chunks);
				middleware = middlewareCode(grai, {
					configName: basename(configFile),
					requestStrategies: requestStrategies(grai.strategy),
					importMaps: building
						? Object.fromEntries(
								Object.entries(maps).map(([locale, map]) => [
									locale,
									`<script type="importmap">${map}</script>`,
								]),
							)
						: undefined,
				});
			},
			"astro:routes:resolved": ({ routes }) => {
				translatable = translatablePages(routes, graiConfig());
				modules.changed(translatedPathsId);
			},
		},
	};
}

/** The project's middleware: grai/astro's, given the output's functions and the configs' facts. */
function middlewareCode(
	grai: Config,
	project: Omit<
		LocaleProject,
		"middleware" | "getTextDirection" | "localeOfPath" | "routeOfPath"
	>,
): string {
	const output = (file: string) => JSON.stringify(join(grai.outdir, file));
	return `import { localeMiddleware } from "grai/astro/middleware";
import { middleware } from ${output("server.js")};
import { getTextDirection } from ${output("runtime.js")};
import { localeOfPath, routeOfPath } from ${output("internal.js")};

export const onRequest = localeMiddleware({ middleware, getTextDirection, localeOfPath, routeOfPath, ...${JSON.stringify(project)} });
`;
}

/**
 * The strategies that read a request beyond its URL: before `url` they outrank the URL's locale,
 * and after it they find the locale of a path that names none. Without `url`, all come before it.
 */
function requestStrategies(
	strategy: readonly Strategy[],
): LocaleProject["requestStrategies"] {
	const url = strategy.indexOf("url");
	return url === -1
		? { beforeUrl: strategy, afterUrl: [] }
		: { beforeUrl: strategy.slice(0, url), afterUrl: strategy.slice(url + 1) };
}

/**
 * The Vite plugin that serves the modules the integration writes, once Astro's config is done:
 * the project's middleware, and the paths of the pages in a locale's words. In dev, a module whose
 * code changes, as Astro's routes do, is loaded again.
 */
function virtualModules(code: Record<string, () => string | undefined>): {
	plugin: Plugin;
	changed(id: string): void;
} {
	let server: ViteDevServer | undefined;
	return {
		plugin: {
			name: "grai:astro",
			configureServer: (dev) => {
				server = dev;
			},
			resolveId: (id) => (id in code ? `\0${id}` : null),
			load: (id) =>
				id.startsWith("\0") ? (code[id.slice(1)]?.() ?? null) : null,
		},
		changed(id) {
			for (const environment of Object.values(server?.environments ?? {})) {
				const graph = environment.moduleGraph;
				const loaded = graph.getModuleById(`\0${id}`);
				if (loaded !== undefined) graph.invalidateModule(loaded);
			}
		},
	};
}

/** Writes a file's text, unless it has it already, which a watcher would take for an edit. */
function written(file: URL, text: string): void {
	if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
		writeFileSync(file, text);
	}
}

/**
 * Where the client build's chunks are served from: Astro's `build.assets` under the scripts'
 * assets prefix, or else under the base. grai/vite puts the message chunks in `grai/` there, and
 * each locale's copies in `grai-<locale>/`.
 */
function chunksUrl({ base, build }: AstroConfig): string {
	const prefix =
		typeof build.assetsPrefix === "string"
			? build.assetsPrefix
			: (build.assetsPrefix?.js ?? build.assetsPrefix?.fallback);
	return `${(prefix ?? base).replace(/\/$/, "")}/${build.assets}/`;
}

/** Each locale's import map, from the shared message chunks to that locale's copies, as JSON. */
function importMaps(
	locales: readonly string[],
	chunks: string,
): Record<string, string> {
	return Object.fromEntries(
		locales.map((locale) => [
			locale,
			JSON.stringify({
				imports: {
					[`${chunks}${messageDirectory}/`]: `${chunks}${localeDirectory(locale)}/`,
				},
			}),
		]),
	);
}

/** The algorithm of the app's CSP, `true` taking Astro's default; undefined without one. */
function cspAlgorithm({
	security: { csp },
}: AstroConfig): "SHA-256" | "SHA-384" | "SHA-512" | undefined {
	if (csp === true) return "SHA-256";
	return typeof csp === "object" ? csp.algorithm : undefined;
}

/** An inline script's hash, as a CSP lists it. */
function scriptHash(script: string): `sha256-${string}` {
	return `sha256-${createHash("sha256").update(script).digest("base64")}`;
}
