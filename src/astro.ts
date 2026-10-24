import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";
import { disagreements } from "./astro/agreement.ts";
import type { LocaleProject } from "./astro/middleware.ts";
import { compile } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { GraiError, messagesOf } from "./error.ts";
import { grai as graiVite } from "./vite.ts";

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
 *   of the app's own.
 */
export function grai(options: GraiAstroOptions = {}): AstroIntegration {
	let configFile = "";
	let middleware: string | undefined;
	return {
		name: "grai",
		hooks: {
			"astro:config:setup": async ({
				config,
				command,
				updateConfig,
				addMiddleware,
			}) => {
				configFile = resolve(
					fileURLToPath(config.root),
					options.config ?? "grai.config.json",
				);
				if (command === "sync") {
					const { errors } = await compile(configFile);
					if (errors.length > 0) throw new Error(messagesOf(errors));
				}
				updateConfig({
					vite: {
						plugins: [
							graiVite({ config: configFile, reloadOnEdit: true }),
							middlewareModule(() => middleware),
						],
					},
				});
				addMiddleware({ order: "pre", entrypoint: middlewareId });
			},
			"astro:config:done": ({ config }) => {
				const grai = readConfig(configFile);
				const problems = disagreements(grai, config);
				if (problems.length > 0) {
					throw new GraiError(
						"config-invalid",
						{ file: basename(configFile) },
						`grai's config and Astro's disagree.\n${problems.join("\n")}`,
					);
				}
				middleware = middlewareCode(grai, {
					configName: basename(configFile),
					requestStrategies: grai.strategy.filter((name) => name !== "url"),
				});
			},
		},
	};
}

/** The project's middleware: grai/astro's, given the output's functions and the configs' facts. */
function middlewareCode(
	grai: Config,
	project: Omit<LocaleProject, "middleware" | "getTextDirection">,
): string {
	const output = (file: string) => JSON.stringify(join(grai.outdir, file));
	return `import { localeMiddleware } from "grai/astro/middleware";
import { middleware } from ${output("server.js")};
import { getTextDirection } from ${output("runtime.js")};

export const onRequest = localeMiddleware({ middleware, getTextDirection, ...${JSON.stringify(project)} });
`;
}

/** The Vite plugin that serves the project's middleware, once Astro's config is done. */
function middlewareModule(code: () => string | undefined): Plugin {
	const resolved = `\0${middlewareId}`;
	return {
		name: "grai:astro",
		resolveId: (id) => (id === middlewareId ? resolved : null),
		load: (id) => (id === resolved ? code() : null),
	};
}
