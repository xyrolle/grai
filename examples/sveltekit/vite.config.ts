import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { grai } from "grai/svelte";
import { defineConfig } from "vite";

// `vite build --mode cookie` builds the same app with grai.cookie.json's strategy: the cookie,
// else the browser's languages, instead of the URL prefix.
export default defineConfig(({ mode }) => ({
	plugins: [
		grai({
			config: mode === "cookie" ? "grai.cookie.json" : "grai.config.json",
		}),
		sveltekit({ adapter: adapter() }),
	],
}));
