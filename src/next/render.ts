// The locale of server components. Next renders a request's layouts and pages side by side, and
// on a client navigation only some of them, so each one that renders messages binds the locale;
// React's cache keeps it for the rest of that request's render.
import { bindRequests, type RequestLocale } from "grai/next/output/internal.js";
import {
	assertIsLocale,
	GraiError,
	locales,
} from "grai/next/output/runtime.js";
import { cache } from "react";

export { LocaleProvider } from "./provider.ts";

/**
 * The request's locale: one record per request's render, which `bindLocale` fills and `setLocale`
 * in the render changes in place.
 */
const request = cache((): Partial<RequestLocale> => ({}));

function isBound(record: Partial<RequestLocale>): record is RequestLocale {
	return record.index !== undefined;
}

bindRequests({
	getStore() {
		const record = request();
		if (!isBound(record)) {
			throw new GraiError(
				"locale-unbound",
				"A server component rendered a message before its page or layout bound the locale. Call bindLocale(locale) at the start of each page and layout, and of generateMetadata. Outside a render, pass { locale } to the message.",
			);
		}
		return record;
	},
});

/**
 * Binds the locale for the rest of the request's render: a page, a layout or `generateMetadata`
 * calls it before any message, with the locale its params name.
 */
export function bindLocale(locale: string): void {
	request().index = locales.indexOf(assertIsLocale(locale));
}
