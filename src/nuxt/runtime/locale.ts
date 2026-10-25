import { locales, type RequestLocale } from "grai/nuxt/output/runtime.js";
import { localeOf, vary } from "grai/nuxt/output/server.js";
import { defineEventHandler, type EventHandler } from "nuxt/server";
import { requestLocaleKey } from "./request-locale.ts";

/**
 * The server middleware: resolves each request's locale once, as the output's middleware does,
 * keeps it on the request's event for Nuxt's render, and adds the request headers the strategy
 * read to the response's `Vary`, so a shared cache keeps a page per locale.
 */
const handler: EventHandler<void> = defineEventHandler((event) => {
	const kept: RequestLocale = { index: locales.indexOf(localeOf(event.req)) };
	event.context[requestLocaleKey] = kept;
	if (vary !== "") event.res.headers.append("vary", vary);
});
export default handler;
