// The locale a test renders in. The compiler copies this file into the output with its imports
// naming the output's modules, and @xyrolle/grai/vite refuses it in a build, so it never ships.
import { locales } from "./config.js";
import { assertIsLocale, bindLocale, getTextDirection } from "./runtime.js";

/**
 * Binds a locale for the test, as if the page had loaded in it: the messages called next render in
 * it, and so does a call that names it, which a page in another locale refuses. A test holds every
 * locale's messages, so it can bind any. In a page, it also sets `<html lang>` and `dir`. Inside a
 * request, the request's locale still holds. It binds a page's or a script's locale: a process that
 * loads server.js renders every message in a request, so a test there runs in server.js's
 * `withLocale`.
 *
 * @param {string} locale
 */
export function useLocale(locale) {
	const bound = assertIsLocale(locale);
	bindLocale(locales.indexOf(bound));
	if (typeof document === "undefined") return;
	document.documentElement.lang = bound;
	document.documentElement.dir = getTextDirection(bound);
}
