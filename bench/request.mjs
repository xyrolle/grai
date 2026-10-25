// Runs work as a server does inside one request for a locale: Paraglide's middleware and grai's
// own resolve it from the request as the app's strategy says, and the prototype's server entries
// bind the same locale.
import { join } from "node:path";
import { graiOutput } from "./grai.mjs";
import { paraglideOutput } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";

/** The path of a page in `locale`: prefixed when the app's strategy reads the URL first. */
export function localePath(app, locale) {
	return app.compilerOptions.strategy[0] === "url" && locale !== app.baseLocale
		? `/${locale}/page`
		: "/page";
}

export async function inRequest(app, locale, work) {
	const { paraglideMiddleware } = await import(
		join(await paraglideOutput(app), "server.js")
	);
	const { middleware } = await import(
		join((await graiOutput(app)).outdir, "server.js")
	);
	const prototype = writePrototype(app);
	const { withLocale } = await import(join(prototype, "server.js"));
	const { withLocale: withVariable } = await import(
		join(prototype, "server-variable.js")
	);
	const { strategy, cookieName } = app.compilerOptions;
	const path = localePath(app, locale);
	const headers = strategy.includes("cookie")
		? { cookie: `${cookieName}=${locale}` }
		: {};
	const request = new Request(`https://bench.test${path}`, { headers });
	const resolvedAs = (library, resolved) => {
		if (resolved !== locale)
			throw new Error(
				`${library} resolved ${resolved} for ${path}, expected ${locale}`,
			);
	};
	let result;
	await paraglideMiddleware(request, ({ locale: resolved }) => {
		resolvedAs("Paraglide", resolved);
		result = middleware(request, ({ locale: graiLocale }) => {
			resolvedAs("grai", graiLocale);
			return withLocale(locale, () => withVariable(locale, work));
		});
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
