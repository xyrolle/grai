import node from "@astrojs/node";
import react from "@astrojs/react";
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";
import { grai } from "grai/astro";
import site from "./astro.config.ts";

// The same site under /shop, rendered on demand by the Node adapter: Astro's base, and the base
// path grai.base.json names too.
export default defineConfig({
	...site,
	base: "/shop",
	integrations: [grai({ config: "grai.base.json" }), svelte(), react()],
	output: "server",
	adapter: node({ mode: "standalone" }),
	outDir: "dist-base",
});
