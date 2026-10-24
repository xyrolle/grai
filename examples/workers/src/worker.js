// A Worker that answers each request in its reader's language. grai's middleware resolves the
// locale by grai.config.json's strategy, the cookie and then Accept-Language, and binds it while
// the handler runs, so every message the page calls is in that locale.
import { m } from "./i18n/messages.js";
import { getTextDirection } from "./i18n/runtime.js";
import { middleware } from "./i18n/server.js";

export default {
	fetch: (request) => middleware(request, ({ locale }) => page(locale)),
};

/** @param {string} locale */
function page(locale) {
	const html = `<!doctype html>
<html lang="${locale}" dir="${getTextDirection()}">
<title>${m.title()}</title>
<h1>${m.greeting({ name: "Workers" })}</h1>
</html>`;
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
