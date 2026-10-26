import type { Plugin } from "vite";
import { svelteTexts } from "./svelte-texts.ts";
import {
	type GraiAdapter,
	type GraiOptions,
	graiPlugin,
} from "./vite-plugin.ts";

/** grai/svelte's plugins, with what a framework built on Svelte tells grai's own. */
export function sveltePlugins(
	options: GraiOptions,
	adapter: GraiAdapter,
): Plugin[] {
	const core = graiPlugin(options, adapter);
	return [...core.plugins, svelteTexts(core)];
}
