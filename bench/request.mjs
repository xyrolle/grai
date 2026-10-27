// Runs work as a server does inside one request for a locale, through the library's own server
// entry as its build has it, so that the request's locale reaches the same runtime as the
// messages: grai's middleware and Paraglide's resolve it from the request as the app's strategy
// says, and the prototype's entries bind it.

/** The path of a page in `locale`: prefixed when the app's strategy reads the URL first. */
export function localePath(app, locale) {
	return app.compilerOptions.strategy[0] === "url" && locale !== app.baseLocale
		? `/${locale}/page`
		: "/page";
}

/** The request a reader in `locale` sends for the page: at the locale's URL, with the app's cookie. */
function requestIn(app, locale) {
	const { strategy, cookieName } = app.compilerOptions;
	const headers = strategy.includes("cookie")
		? { cookie: `${cookieName}=${locale}` }
		: {};
	return new Request(`https://bench.test${localePath(app, locale)}`, {
		headers,
	});
}

/**
 * Runs `work` inside one request for `locale` and returns what it returns. `server` is the
 * library's server entry as built: grai's `middleware` or Paraglide's `paraglideMiddleware`, whose
 * handler answers with a Response as a server's does, or else the prototype's `withLocale`. A
 * library without one, whose translator is made for the locale, runs `work` as it is.
 */
export async function inRequest(app, locale, server, work) {
	const middleware = server.middleware ?? server.paraglideMiddleware;
	if (middleware === undefined)
		return server.withLocale === undefined
			? work()
			: server.withLocale(locale, work);
	const request = requestIn(app, locale);
	let result;
	await middleware(request, ({ locale: resolved }) => {
		if (resolved !== locale)
			throw new Error(
				`The middleware resolved ${resolved} for ${request.url}, expected ${locale}`,
			);
		result = work();
		return new Response("");
	});
	return result;
}

/** The locale benches show beside the base one: Russian where the app has it, the longest words. */
export function otherLocale(app) {
	return app.locales.includes("ru") && app.baseLocale !== "ru"
		? "ru"
		: app.locales.find((locale) => locale !== app.baseLocale);
}
