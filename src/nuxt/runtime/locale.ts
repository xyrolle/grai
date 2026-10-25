import { locales, type RequestLocale } from "grai/nuxt/output/runtime.js";
import { localeOf, redirectOf, vary } from "grai/nuxt/output/server.js";
import { defineEventHandler, type EventHandler } from "nuxt/server";
import { requestLocaleKey } from "./request-locale.ts";

/**
 * The server middleware: as the output's middleware does, sends a page asked for without the
 * locale prefix it needs to its locale's path, else resolves the request's locale once, keeps it
 * on the request's event for Nuxt's render, and adds the request headers the strategy read to the
 * response's `Vary`, so a shared cache keeps a page per locale.
 */
const handler: EventHandler<Response | undefined> = defineEventHandler(
	(event) => {
		const redirect = redirectOf(event.req);
		if (redirect !== undefined) return redirect;
		const kept: RequestLocale = {
			index: locales.indexOf(localeOf(event.req)),
		};
		event.context[requestLocaleKey] = kept;
		if (vary !== "") event.res.headers.append("vary", vary);
		return undefined;
	},
);
export default handler;
