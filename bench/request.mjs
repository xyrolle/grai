// Runs work as a server does inside one request for a locale: Paraglide's middleware resolves it
// from the request as the app's strategy says, and grai's server entries bind the same locale.
import { join } from "node:path";
import { paraglideOutput } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";

export async function inRequest(app, locale, work) {
	const { paraglideMiddleware } = await import(
		join(await paraglideOutput(app), "server.js")
	);
	const prototype = writePrototype(app);
	const { withLocale } = await import(join(prototype, "server.js"));
	const { withLocale: withVariable } = await import(
		join(prototype, "server-variable.js")
	);
	const { withLocale: withShared } = await import(
		join(prototype, "server-shared.js")
	);
	const { strategy, cookieName } = app.compilerOptions;
	const path =
		strategy[0] === "url" && locale !== app.baseLocale
			? `/${locale}/page`
			: "/page";
	const headers = strategy.includes("cookie")
		? { cookie: `${cookieName}=${locale}` }
		: {};
	let result;
	await paraglideMiddleware(
		new Request(`https://bench.test${path}`, { headers }),
		({ locale: resolved }) => {
			if (resolved !== locale)
				throw new Error(
					`Paraglide resolved ${resolved} for ${path}, expected ${locale}`,
				);
			result = withLocale(locale, () =>
				withShared(locale, () => withVariable(locale, work)),
			);
			return new Response("");
		},
	);
	return result;
}

/** The locale benches show beside the base one: Russian where the app has it, the longest words. */
export function otherLocale(app) {
	return app.locales.includes("ru") && app.baseLocale !== "ru"
		? "ru"
		: app.locales.find((locale) => locale !== app.baseLocale);
}
