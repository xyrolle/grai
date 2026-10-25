import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { grai as svelteGrai } from "grai/svelte";
import { grai } from "grai/sveltekit/vite";
import { defineConfig } from "vite";

// `vite build --mode cookie` builds the same app with grai.cookie.json's strategy, the cookie,
// else the browser's languages, instead of the URL prefix. `vite build --mode svelte` builds it
// with grai/svelte's plugin, which writes no locale copies.
export default defineConfig(({ mode }) => ({
	plugins: [
		mode === "svelte"
			? svelteGrai()
			: grai({
					config: mode === "cookie" ? "grai.cookie.json" : "grai.config.json",
				}),
		sveltekit({ adapter: adapter() }),
	],
}));
