import type { Handle } from "@sveltejs/kit/hooks";
import { localeDirectory, messageDirectory } from "./message-directories.ts";

/** Where `src/app.html` takes the page's locale and its text direction. */
const LANG = "%grai.lang%";
const DIR = "%grai.dir%";

/** Kit's preload of its client entry, in the directory of the build's immutable files. */
const ENTRY_PRELOAD =
	/<link href="([^"]*\/immutable\/)entry\/start\.[^"]*" rel="modulepreload">/;
/** Where Kit's build puts its chunks, within that directory, grai/vite's message chunks among them. */
const CHUNKS = "chunks/";
/** Kit's preload of a message chunk, with what comes before and after the message directory. */
const MESSAGE_PRELOAD = new RegExp(
	`(<link href="[^"]*/immutable/${CHUNKS})${messageDirectory}/([^"]*" rel="modulepreload">)`,
	"g",
);

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
	/**
	 * `localeCopies` from the output's `server.js`: whether its build wrote a copy of each message
	 * chunk per locale, as `grai/sveltekit/vite`'s does. Without them a page gets no import map.
	 */
	localeCopies: boolean;
};

/**
 * The `handle` that renders each request in its locale. It resolves the locale by the project's
 * strategy, binds it for everything the request renders and loads, and writes it into
 * `src/app.html`'s `%grai.lang%` and `%grai.dir%`:
 *
 *     export const handle = handleLocale({ middleware, getTextDirection, localeCopies });
 *
 * The browser then takes the page's `<html lang>` as its locale, so it hydrates in the words the
 * server drew. A built page loads only its locale's copies of the message chunks, which
 * `grai/sveltekit/vite`'s plugin writes.
 */
export function handleLocale({
	middleware,
	getTextDirection,
	localeCopies,
}: CompiledLocale): Handle {
	return ({ event, resolve }) =>
		middleware(event.request, ({ locale }) =>
			resolve(event, {
				transformPageChunk: ({ html }) => {
					const pointed = localeCopies
						? localeChunks(html, locale, event.url)
						: html;
					return pointed
						.replaceAll(LANG, locale)
						.replaceAll(DIR, getTextDirection(locale));
				},
			}),
		);
}

/**
 * Points a built page at its locale's copies of the message chunks. One import map entry maps the
 * shared directory to the locale's, for every message chunk the page and its later navigations
 * import, ahead of Kit's preloads. Kit's preloads of the shared chunks name the locale's copies
 * instead, as browsers apply no import map to `modulepreload` and would fetch both. A page without Kit's client entry,
 * or a dev page, is left as it is.
 */
function localeChunks(html: string, locale: string, page: URL): string {
	const entry = ENTRY_PRELOAD.exec(html);
	if (entry?.[1] === undefined) return html;
	const immutable = new URL(entry[1], page);
	const at =
		immutable.origin === page.origin ? immutable.pathname : immutable.href;
	const map = JSON.stringify({
		imports: {
			[`${at}${CHUNKS}${messageDirectory}/`]: `${at}${CHUNKS}${localeDirectory(locale)}/`,
		},
	});
	const mapped =
		html.slice(0, entry.index) +
		`<script type="importmap">${map}</script>` +
		html.slice(entry.index);
	return mapped.replaceAll(MESSAGE_PRELOAD, `$1${localeDirectory(locale)}/$2`);
}
