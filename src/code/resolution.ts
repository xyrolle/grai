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
import type { AliasOptions } from "vite";
import { GraiError } from "../error.ts";

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

/**
 * What a project's imports resolve by, as data a worker can be sent: its tsconfig, and its Vite
 * config's aliases.
 */
export type Resolution = {
	tsconfig: string | undefined;
	aliases: Alias[];
};

/**
 * The project's resolution: its Vite aliases, if it has a Vite config, then its tsconfig; or the
 * error when either cannot be read, as the bundler would fail on it too.
 */
export async function projectResolution(
	root: string,
): Promise<Resolution | GraiError> {
	const aliases = await viteAliases(root);
	if (aliases instanceof GraiError) return aliases;
	const file = join(root, "tsconfig.json");
	const resolution = {
		tsconfig: existsSync(file) ? file : undefined,
		aliases,
	};
	// A tsconfig the resolver cannot follow, such as one that extends or references what a framework
	// generates before it is generated, fails every import, and a command would then read none.
	const { error } =
		resolution.tsconfig === undefined
			? {}
			: resolverOf(resolution).resolveFileSync(file, "./tsconfig.json");
	if (error !== undefined) {
		return new GraiError(
			"resolution-invalid",
			{ file: "tsconfig.json" },
			`the project's tsconfig cannot be followed: ${error}. Generate what it extends or references, as SvelteKit's svelte-kit sync or Nuxt's nuxi prepare does, or fix it.`,
		);
	}
	return resolution;
}

/**
 * Where an import resolves from the importing file, by the project's resolution, or undefined when
 * it names no file: the first Vite alias that matches, then `oxc-resolver`.
 */
export function resolverFor(
	resolution: Resolution,
): (source: string, importer: string) => string | undefined {
	const resolver = resolverOf(resolution);
	return (source, importer) =>
		resolver.resolveFileSync(importer, aliased(resolution.aliases, source))
			.path ?? undefined;
}

function resolverOf({ tsconfig }: Resolution): ResolverFactory {
	return new ResolverFactory({
		// The project's tsconfig for every module, as SvelteKit, Astro and Next apply its paths: to a
		// component too, which the `include` of a tsconfig found by the file's own place may not list.
		...(tsconfig === undefined
			? {}
			: { tsconfig: { configFile: tsconfig, references: "auto" } }),
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
async function viteAliases(root: string): Promise<Alias[] | GraiError> {
	const file = configFiles.find((name) => existsSync(join(root, name)));
	if (file === undefined) return [];
	let alias: AliasOptions | undefined;
	try {
		const { loadConfigFromFile } = await import("vite");
		const loaded = await loadConfigFromFile(
			{ command: "build", mode: "production" },
			join(root, file),
			root,
			"silent",
		);
		alias = loaded?.config.resolve?.alias;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return new GraiError(
			"resolution-invalid",
			{ file },
			`the project's Vite config cannot be loaded, so its aliases are unknown: ${message.split("\n")[0]}. Fix it, as the build fails on it too.`,
		);
	}
	if (alias === undefined) return [];
	return Array.isArray(alias)
		? alias.map(({ find, replacement }) => ({ find, replacement }))
		: Object.entries(alias).map(([find, replacement]) => ({
				find,
				replacement,
			}));
}
