import type { Handle } from "@sveltejs/kit/hooks";

/** Where `src/app.html` takes the page's locale and its text direction. */
const LANG = "%grai.lang%";
const DIR = "%grai.dir%";

/**
 * What the handle takes from the project's compiled output: its `server.js` and `runtime.js`.
 * Methods, so that the output's functions, typed with the project's own locales, fit.
 */
export type CompiledLocale = {
	/** `middleware` from the output's `server.js`. */
	middleware(
		request: Request,
		handler: (resolved: {
			request: Request;
			locale: string;
		}) => Response | Promise<Response>,
	): Response | Promise<Response>;
	/** `getTextDirection` from the output's `runtime.js`. */
	getTextDirection(locale?: string): "ltr" | "rtl";
};

/**
 * The `handle` that renders each request in its locale. It resolves the locale by the project's
 * strategy, binds it for everything the request renders and loads, and writes it into
 * `src/app.html`'s `%grai.lang%` and `%grai.dir%`:
 *
 *     export const handle = handleLocale({ middleware, getTextDirection });
 *
 * The browser then takes the page's `<html lang>` as its locale, so it hydrates in the words the
 * server drew.
 */
export function handleLocale({
	middleware,
	getTextDirection,
}: CompiledLocale): Handle {
	return ({ event, resolve }) =>
		middleware(event.request, ({ locale }) =>
			resolve(event, {
				transformPageChunk: ({ html }) =>
					html
						.replaceAll(LANG, locale)
						.replaceAll(DIR, getTextDirection(locale)),
			}),
		);
}
