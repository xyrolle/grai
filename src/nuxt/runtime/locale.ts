import {
	hostsLocales,
	locales,
	type RequestLocale,
} from "grai/nuxt/output/internal.js";
import { localeOf, redirectOf, vary } from "grai/nuxt/output/server.js";
import { defineEventHandler, type EventHandler } from "nuxt/server";
import { requestLocaleKey } from "./request-locale.ts";

/**
 * The server middleware: as the output's middleware does, sends a page asked for without the
 * locale prefix it needs to its locale's path, else resolves the request's locale once, keeps it
 * on the request's event for Nuxt's render, and adds the request headers the strategy read to the
 * response's `Vary`, so a shared cache keeps a page per locale.
 */
const handler: EventHandler<Promise<Response | undefined>> = defineEventHandler(
	async (event) => {
		const redirect = await redirectOf(event.req);
		if (redirect !== undefined) return redirect;
		// Where a locale has a host of its own, the origin goes with the locale, so that a link to
		// another locale's host is a whole URL.
		const index = locales.indexOf(await localeOf(event.req));
		const kept: RequestLocale = hostsLocales
			? { index, origin: new URL(event.req.url).origin }
			: { index };
		event.context[requestLocaleKey] = kept;
		if (vary !== "") event.res.headers.append("vary", vary);
		return undefined;
	},
);
export default handler;
