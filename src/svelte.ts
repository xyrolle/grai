import type { Plugin } from "vite";
import { svelteTexts } from "./svelte-texts.ts";
import { type GraiOptions, graiPlugin } from "./vite-plugin.ts";

/**
 * grai's Vite plugin for a Svelte app: `grai/vite`'s, plus a client build that reads each call of
 * a message without inputs, such as `{m.title()}`, as that message's string in the page's locale.
 * Svelte then renders it as a plain value, with no signal of its own to create as the page
 * hydrates. List it before `sveltekit()` or `svelte()`:
 *
 *     plugins: [grai(), sveltekit()]
 *
 * The server build reads the same calls as a property, in the request's locale, so that Svelte
 * compiles the same blocks on both sides. Dev and `"switch": "live"` keep every call as it is.
 */
export function grai(options: GraiOptions = {}): Plugin[] {
	const core = graiPlugin(options);
	return [core.plugin, svelteTexts(core)];
}
