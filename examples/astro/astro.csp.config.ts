import { defineConfig } from "astro/config";
import site from "./astro.config.ts";

// The same static site under Astro's CSP, which lets each page's import map through by its hash.
export default defineConfig({
	...site,
	security: { csp: true },
	outDir: "dist-csp",
});
