// Where a request's locale is kept while Nuxt renders it: on the request's event, as the record
// the runtime reads and setLocale changes. Nuxt bundles its server and its app apart, each with a
// copy of the output of its own, and both are given the event, so the server middleware
// (locale.ts) puts the record there and the app's plugin (plugin.ts) reads it.
import { GraiError, type RequestLocale } from "grai/nuxt/output/runtime.js";

export const requestLocaleKey = "grai:locale";

/**
 * The locale kept on a request's event, the record itself, so that a setLocale in the render
 * changes it; or throws, as no request is being rendered.
 */
export function requestLocale(
	context: Readonly<Record<string, unknown>> | undefined,
): RequestLocale {
	const kept = context?.[requestLocaleKey];
	if (isRequestLocale(kept)) return kept;
	throw new GraiError(
		"locale-unbound",
		"A message was rendered on the server outside a Nuxt render: at a module's top level, or after an await outside a component's setup. Call it in a component's setup or template, or pass { locale } to it.",
	);
}

function isRequestLocale(value: unknown): value is RequestLocale {
	return (
		typeof value === "object" &&
		value !== null &&
		"index" in value &&
		typeof value.index === "number"
	);
}
