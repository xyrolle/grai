import {
	assertIsLocale,
	bindRequests,
	extractLocaleFromUrl,
	getLocale,
	getTextDirection,
	locales,
	strategy,
} from "@xyrolle/grai/nuxt/output/internal.js";
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
// middleware of the render can find, and the app's event holds the request's locale.
if (import.meta.server) {
	bindRequests({
		getStore: () => requestLocale(tryUseNuxtApp()?.ssrContext?.event.context),
	});
}

/**
 * Writes the page's locale and direction to its `<html>`, points it at its locale's message
 * chunks, and, with the `url` strategy, loads the page anew for a link into another locale.
 */
const plugin: Plugin = defineNuxtPlugin({
	name: "grai",
	setup(nuxtApp) {
		// The request's locale on the server, read as the head is written, after the render, so that
		// a setLocale in the render counts; in a browser, the page's <html lang>.
		const kept = import.meta.server
			? requestLocale(nuxtApp.ssrContext?.event.context)
			: undefined;
		const locale = () =>
			kept === undefined ? getLocale() : assertIsLocale(locales[kept.index]);
		useHead({
			htmlAttrs: { lang: locale, dir: () => getTextDirection(locale()) },
		});
		if (import.meta.server && !import.meta.dev) {
			nuxtApp.ssrContext?.head.use({
				key: "grai",
				hooks: {
					"ssr:render": ({ tags }: { tags: HeadTag[] }) =>
						pointAtLocaleChunks(tags, locale()),
				},
			});
		}
		if (import.meta.client && strategy.includes("url")) {
			// A page holds its own locale's words alone, so a navigation into another loads that page.
			addRouteMiddleware(
				"grai:locale",
				(to) => {
					const url = new URL(to.fullPath, useRequestURL());
					if (extractLocaleFromUrl(url) !== locale()) {
						return navigateTo(to.fullPath, { external: true });
					}
				},
				{ global: true },
			);
		}
	},
});
export default plugin;
