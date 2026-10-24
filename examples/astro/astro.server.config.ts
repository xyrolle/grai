import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import site from "./astro.config.ts";

// The same site, rendered on demand by the Node adapter.
export default defineConfig({
	...site,
	output: "server",
	adapter: node({ mode: "standalone" }),
	outDir: "dist-server",
});
