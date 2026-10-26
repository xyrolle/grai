import { beforeNavigate } from "$app/navigation";

/** What the guard takes from the project's output: its `runtime.js`'s `localizeUrl`. */
export type PageUrls = {
	/** `localizeUrl` from the output's `runtime.js`: a URL in the page's locale, by default. */
	localizeUrl(url: URL): URL;
};

/**
 * Loads a page of another locale as a document, which the server draws in that locale, rather
 * than letting Kit's client draw it in this one: a page holds its own locale's words, and its
 * `<html lang>` and import map are the document's. A URL is another locale's when putting it in
 * the page's locale changes its path; a navigation within the page's locale, or to a path the
 * locale leaves alone, stays Kit's. Call it once, as the root layout initializes:
 *
 *     reloadAcrossLocales({ localizeUrl });
 */
export function reloadAcrossLocales({ localizeUrl }: PageUrls): void {
	beforeNavigate((navigation) => {
		const target = navigation.to?.url;
		if (target === undefined || navigation.willUnload) return;
		if (localizeUrl(target).pathname === target.pathname) return;
		// Back and forward have moved the browser to the page already, so loading it keeps the
		// history as it is; any other navigation is cancelled for the document's own.
		if (navigation.type === "popstate") {
			location.reload();
		} else {
			navigation.cancel();
			location.assign(target);
		}
	});
}
