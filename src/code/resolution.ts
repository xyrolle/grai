/**
 * How the CLI resolves an import, as the project's bundler would: the project's own Vite aliases
 * first, as Vite applies them, then `oxc-resolver`, the resolver Rolldown is built on, with the
 * `paths` of the project's tsconfig (following `extends`, so SvelteKit's generated one brings
 * `$lib`), package.json `imports` and `exports`, and TypeScript's extensions. A build resolves with
 * the bundler itself.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import type { Resolve } from "./modules.ts";

/** A Vite alias: a path or a pattern, and what it is replaced with. */
export type Alias = { find: string | RegExp; replacement: string };

/** The extensions a project's modules are written in, the way Vite tries them. */
const extensions = [
	".mjs",
	".js",
	".mts",
	".ts",
	".jsx",
	".tsx",
	".json",
	".svelte",
	".vue",
	".astro",
	".mdx",
];

/** The project's resolution: its Vite aliases, if it has a Vite config, then `oxc-resolver`. */
export async function projectResolve(root: string): Promise<Resolve> {
	const aliases = await viteAliases(root);
	const tsconfig = join(root, "tsconfig.json");
	const resolver = new ResolverFactory({
		// The project's tsconfig for every module, as SvelteKit, Astro and Next apply its paths: to a
		// component too, which the `include` of a tsconfig found by the file's own place may not list.
		...(existsSync(tsconfig)
			? { tsconfig: { configFile: tsconfig, references: "auto" } }
			: {}),
		conditionNames: ["import", "module", "browser", "default"],
		mainFields: ["module", "main"],
		extensions,
		extensionAlias: {
			".js": [".ts", ".tsx", ".js", ".jsx"],
			".mjs": [".mts", ".mjs"],
			".cjs": [".cts", ".cjs"],
		},
		builtinModules: true,
	});
	return async (source, importer) => {
		const { path } = resolver.resolveFileSync(
			importer,
			aliased(aliases, source),
		);
		return path ?? undefined;
	};
}

/**
 * A path with the first Vite alias that matches it applied, as Vite's alias plugin applies one: a
 * string matches the whole path or a path below it, a pattern matches anywhere it tests true.
 */
export function aliased(aliases: readonly Alias[], source: string): string {
	for (const { find, replacement } of aliases) {
		const matches =
			typeof find === "string"
				? source === find || source.startsWith(`${find}/`)
				: find.test(source);
		if (matches) return source.replace(find, replacement);
	}
	return source;
}

const configFiles = [
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.ts",
	"vite.config.cjs",
	"vite.config.mts",
	"vite.config.cts",
];

/**
 * The aliases the project's Vite config declares, read through Vite's own config loader, which
 * runs none of its plugins; a plugin's aliases are in its generated tsconfig, as SvelteKit's are.
 */
async function viteAliases(root: string): Promise<Alias[]> {
	const file = configFiles.find((name) => existsSync(join(root, name)));
	if (file === undefined) return [];
	const { loadConfigFromFile } = await import("vite");
	const loaded = await loadConfigFromFile(
		{ command: "build", mode: "production" },
		join(root, file),
		root,
		"silent",
	);
	const alias = loaded?.config.resolve?.alias;
	if (alias === undefined) return [];
	return Array.isArray(alias)
		? alias.map(({ find, replacement }) => ({ find, replacement }))
		: Object.entries(alias).map(([find, replacement]) => ({
				find,
				replacement,
			}));
}
