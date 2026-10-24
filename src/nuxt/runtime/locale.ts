import { locales } from "grai/nuxt/output/runtime.js";
import { middleware } from "grai/nuxt/output/server.js";
import { defineEventHandler, type EventHandler } from "nuxt/server";
import { requestLocaleKey } from "./request-locale.ts";

/**
 * The server middleware: resolves each request's locale once, by the config's strategy through
 * the output's middleware, and keeps it on the request's event for Nuxt's render.
 */
const handler: EventHandler<void> = defineEventHandler((event) => {
	const locale = middleware(event.req, (resolved) => resolved.locale);
	event.context[requestLocaleKey] = locales.indexOf(locale);
});
export default handler;
