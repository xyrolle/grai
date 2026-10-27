import react from "@astrojs/react";
import svelte from "@astrojs/svelte";
import { grai } from "@xyrolle/grai/astro";
import { defineConfig } from "astro/config";

// A static site in English, Romanian and Arabic. Astro routes each page by the locale its URL
// names, the base locale's without a prefix, and grai renders it in that locale: the locales and
// the default are grai.config.json's, which grai checks at the build. Pages prerender four at a
// time, each in its own locale.
export default defineConfig({
	i18n: { locales: ["en", "ro", "ar"], defaultLocale: "en" },
	integrations: [grai(), svelte(), react()],
	build: { concurrency: 4 },
});
