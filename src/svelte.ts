import type { Plugin } from "vite";
import { sveltePlugins } from "./svelte-plugins.ts";
import { type GraiOptions, viteBase } from "./vite-plugin.ts";

/**
 * grai's Vite plugin for a Svelte app: `@xyrolle/grai/vite`'s, plus a client build that reads each
 * call of a message without inputs, such as `{m.title()}`, as that message's string in the page's
 * locale. Svelte then renders it as a plain value, with no signal of its own to create as the page
 * hydrates. A SvelteKit app takes `@xyrolle/grai/sveltekit/vite`'s instead. List it before
 * `svelte()`:
 *
 *     plugins: [grai(), svelte()]
 *
 * The server build reads the same calls as a property, in the request's locale, so that Svelte
 * compiles the same blocks on both sides. Dev and `"switch": "live"` keep every call as it is.
 */
export function grai(options: GraiOptions = {}): Plugin[] {
	return sveltePlugins(options, { frameworkBase: viteBase, indexHtml: true });
}
