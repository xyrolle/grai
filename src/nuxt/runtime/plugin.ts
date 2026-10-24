import {
	bindRequests,
	GraiError,
	getLocale,
	getTextDirection,
} from "grai/nuxt/output/runtime.js";
import {
	defineNuxtPlugin,
	type Plugin,
	tryUseNuxtApp,
	useHead,
} from "nuxt/app";
import "../../vue/client.ts";
import { requestLocale } from "./request-locale.ts";

// Nuxt renders each request in an app of its own, which every setup, template, plugin and route
// middleware of the render can find, and the app's event holds the request's locale. The page's
// URL, cookie or Accept-Language names it, so a render cannot change it.
if (import.meta.server) {
	bindRequests({
		getStore: () => requestLocale(tryUseNuxtApp()?.ssrContext?.event.context),
		enterWith() {
			throw new GraiError(
				"locale-unbound",
				"setLocale cannot change the locale of a Nuxt server render, which the request names. Call it in the browser, from an event.",
			);
		},
	});
}

/** Writes the page's locale and direction to its `<html>`. */
const plugin: Plugin = defineNuxtPlugin({
	name: "grai",
	setup() {
		// The request's locale on the server, and the page's <html lang> in a browser.
		const locale = getLocale();
		useHead({ htmlAttrs: { lang: locale, dir: getTextDirection(locale) } });
	},
});
export default plugin;
