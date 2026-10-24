// The locale of server components. Next renders a request's layouts and pages side by side, and
// on a client navigation only some of them, so each one that renders messages binds the locale;
// React's cache keeps it for the rest of that request's render.
import {
	assertIsLocale,
	bindRequests,
	GraiError,
	locales,
} from "grai/next/output/runtime.js";
import { cache } from "react";

export { LocaleProvider } from "./provider.ts";

/** The request's locale, by its position in `locales`: one record per request's render. */
const request = cache((): { index?: number } => ({}));

bindRequests({
	getStore() {
		const { index } = request();
		if (index === undefined) {
			throw new GraiError(
				"locale-unbound",
				"A server component rendered a message before its page or layout bound the locale. Call bindLocale(locale) at the start of each page and layout, and of generateMetadata. Outside a render, pass { locale } to the message.",
			);
		}
		return index;
	},
	enterWith(index) {
		request().index = index;
	},
});

/**
 * Binds the locale for the rest of the request's render: a page, a layout or `generateMetadata`
 * calls it before any message, with the locale its params name.
 */
export function bindLocale(locale: string): void {
	request().index = locales.indexOf(assertIsLocale(locale));
}
