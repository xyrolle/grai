import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { grai as svelteGrai } from "@xyrolle/grai/svelte";
import { grai } from "@xyrolle/grai/sveltekit/vite";
import { defineConfig } from "vite";

// `vite build --mode cookie` builds the same app with grai.cookie.json's strategy, the cookie,
// else the browser's languages, instead of the URL prefix, and with a CSP whose scripts need
// Kit's nonce. `vite build --mode svelte` builds it with @xyrolle/grai/svelte's plugin, which
// writes no locale copies. `vite build --mode base` serves it under /shop, the base path
// grai.base.json names too.
const configs: Record<string, string> = {
	cookie: "grai.cookie.json",
	base: "grai.base.json",
};

export default defineConfig(({ mode }) => ({
	plugins: [
		mode === "svelte"
			? svelteGrai()
			: grai({ config: configs[mode] ?? "grai.config.json" }),
		sveltekit({
			adapter: adapter(),
			csp:
				mode === "cookie"
					? { mode: "nonce", directives: { "script-src": ["self"] } }
					: {},
			paths: { base: mode === "base" ? "/shop" : "" },
		}),
	],
}));
