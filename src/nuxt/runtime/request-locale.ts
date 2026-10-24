// Where a request's locale is kept while Nuxt renders it: on the request's event, as its place in
// `locales`. Nuxt bundles its server and its app apart, each with a copy of the output of its own,
// and both are given the event, so the server middleware (locale.ts) puts the locale there and
// the app's plugin (plugin.ts) reads it.
import { GraiError } from "grai/nuxt/output/runtime.js";

export const requestLocaleKey = "grai:locale";

/** The locale kept on a request's event, by its place in `locales`. */
export function requestLocale(
	context: Readonly<Record<string, unknown>> | undefined,
): number {
	const index = context?.[requestLocaleKey];
	if (typeof index === "number") return index;
	throw new GraiError(
		"locale-unbound",
		"A message was rendered on the server outside a Nuxt render: at a module's top level, or after an await outside a component's setup. Call it in a component's setup or template, or pass { locale } to it.",
	);
}
