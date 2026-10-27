import type { Plugin, ResolvedConfig } from "vite";
import type { FrameworkBase } from "./base-agreement.ts";
import { svelteTexts } from "./svelte-texts.ts";
import { type GraiOptions, graiPlugin } from "./vite-plugin.ts";

/** The plugin's options: `config`, the path of the project's grai.config.json, from Vite's root. */
export type SvelteKitGraiOptions = Pick<GraiOptions, "config">;

/**
 * grai's Vite plugin for a SvelteKit app: `@xyrolle/grai/svelte`'s, which also writes each message
 * chunk's copy per locale, as `@xyrolle/grai/sveltekit`'s `handleLocale` points each built page at
 * its locale's copies. List it before `sveltekit()`:
 *
 *     plugins: [grai(), sveltekit()]
 */
export function grai(options: SvelteKitGraiOptions = {}): Plugin[] {
	const core = graiPlugin(
		{ ...options, localeChunks: true },
		{ frameworkBase: kitBase },
	);
	return [...core.plugins, svelteTexts(core)];
}

/**
 * SvelteKit's `paths.base`, from the options its setup plugin keeps, where Kit itself reads its
 * config from a resolved Vite config. Kit sets Vite's own base to its assets' path, which is
 * not where its pages are.
 */
function kitBase(config: ResolvedConfig): FrameworkBase | undefined {
	const setup = config.plugins.find(
		(plugin) => plugin.name === "vite-plugin-sveltekit-setup",
	);
	const base: unknown = setup?.api?.options?.kit?.paths?.base;
	return typeof base === "string"
		? { option: "SvelteKit's paths.base", base }
		: undefined;
}
