// `GRAI_CONFIG=grai.always.json nuxt build` builds the same app with every locale's paths
// prefixed, Romanian's as /romana, and a page asked for without a prefix sent to the cookie's
// locale, else the browser's language.
export default defineNuxtConfig({
	modules: ["@xyrolle/grai/nuxt"],
	grai: { config: process.env.GRAI_CONFIG ?? "grai.config.json" },
	compatibilityDate: "2026-10-01",
	devtools: { enabled: false },
	telemetry: false,
});
