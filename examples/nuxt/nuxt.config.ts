// `GRAI_CONFIG=grai.cookie.json nuxt build` builds the same app with another strategy: the
// cookie, else the browser's languages, instead of the URL prefix.
export default defineNuxtConfig({
	modules: ["grai/nuxt"],
	grai: { config: process.env.GRAI_CONFIG ?? "grai.config.json" },
	compatibilityDate: "2026-10-01",
	devtools: { enabled: false },
	telemetry: false,
});
