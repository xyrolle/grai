import type { Plugin } from "vite";
import { grai as svelteGrai } from "./svelte.ts";
import type { GraiOptions } from "./vite-plugin.ts";

/** The plugin's options: `config`, the path of the project's grai.config.json, from Vite's root. */
export type SvelteKitGraiOptions = Pick<GraiOptions, "config">;

/**
 * grai's Vite plugin for a SvelteKit app: `grai/svelte`'s, which also writes each message chunk's
 * copy per locale, as `grai/sveltekit`'s `handleLocale` points each built page at its locale's
 * copies. List it before `sveltekit()`:
 *
 *     plugins: [grai(), sveltekit()]
 */
export function grai(options: SvelteKitGraiOptions = {}): Plugin[] {
	return svelteGrai({ ...options, localeChunks: true });
}
