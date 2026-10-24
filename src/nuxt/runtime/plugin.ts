import { strategy } from "grai/nuxt/output/config.js";
import {
	bindRequests,
	extractLocaleFromUrl,
	GraiError,
	getLocale,
	getTextDirection,
} from "grai/nuxt/output/runtime.js";
import {
	addRouteMiddleware,
	defineNuxtPlugin,
	navigateTo,
	type Plugin,
	tryUseNuxtApp,
	useHead,
	useRequestURL,
} from "nuxt/app";
import "../../vue/client.ts";
import { type HeadTag, pointAtLocaleChunks } from "./locale-chunks.ts";
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

/**
 * Writes the page's locale and direction to its `<html>`, points it at its locale's message
 * chunks, and, with the `url` strategy, loads the page anew for a link into another locale.
 */
const plugin: Plugin = defineNuxtPlugin({
	name: "grai",
	setup(nuxtApp) {
		// The request's locale on the server, and the page's <html lang> in a browser.
		const locale = getLocale();
		useHead({ htmlAttrs: { lang: locale, dir: getTextDirection(locale) } });
		if (import.meta.server && !import.meta.dev) {
			nuxtApp.ssrContext?.head.use({
				key: "grai",
				hooks: {
					"ssr:render": ({ tags }: { tags: HeadTag[] }) =>
						pointAtLocaleChunks(tags, locale),
				},
			});
		}
		if (import.meta.client && strategy.includes("url")) {
			// A page holds its own locale's words alone, so a navigation into another loads that page.
			addRouteMiddleware(
				"grai:locale",
				(to) => {
					const url = new URL(to.fullPath, useRequestURL());
					if (extractLocaleFromUrl(url) !== locale) {
						return navigateTo(to.fullPath, { external: true });
					}
				},
				{ global: true },
			);
		}
	},
});
export default plugin;
