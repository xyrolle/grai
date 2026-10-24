import { renderToString } from "vue/server-renderer";
import { baseLocale, getTextDirection, type Locale } from "./i18n/runtime.js";
import { middleware } from "./i18n/server.js";
import { createApp } from "./main.ts";

/** index.html's `<html>`, a page in the base locale, which a render writes its own locale into. */
const html = htmlOf(baseLocale);

/**
 * Renders the page for a request into `template`, in the locale grai.config.json's strategy finds
 * in the request (here its cookie, else its Accept-Language). The output's middleware binds that
 * locale while the app renders, awaits included, so requests rendered at once never mix their
 * locales, and its response varies by the headers the strategy read.
 */
export function render(request: Request, template: string): Promise<Response> {
	return middleware(request, async ({ locale }) => {
		const page = template
			.replace(html, htmlOf(locale))
			.replace("<!--app-html-->", await renderToString(createApp()));
		return new Response(page, {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	});
}

/** The page's `<html>` in a locale: its tag, and the direction its script is written in. */
function htmlOf(locale: Locale): string {
	return `<html lang="${locale}" dir="${getTextDirection(locale)}">`;
}
