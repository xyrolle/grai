// Where a request's locale is kept while Nuxt renders it: on the request's event, as the record
// the runtime reads and setLocale changes. Nuxt bundles its server and its app apart, each with a
// copy of the output of its own, and both are given the event, so the server middleware
// (locale.ts) puts the record there and the app's plugin (plugin.ts) reads it.
import type { RequestLocale } from "grai/nuxt/output/internal.js";

export const requestLocaleKey = "grai:locale";

/**
 * The locale kept on a request's event, the record itself, so that a setLocale in the render
 * changes it; undefined outside a render, where the runtime throws `locale-unbound`.
 */
export function requestLocale(
	context: Readonly<Record<string, unknown>> | undefined,
): RequestLocale | undefined {
	const kept = context?.[requestLocaleKey];
	return isRequestLocale(kept) ? kept : undefined;
}

function isRequestLocale(value: unknown): value is RequestLocale {
	return (
		typeof value === "object" &&
		value !== null &&
		"index" in value &&
		typeof value.index === "number"
	);
}
