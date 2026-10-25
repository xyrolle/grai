import type { GraiError } from "./error.ts";

/**
 * The name of a place a strategy reads, from the config's `field`: required when `strategy` lists
 * the place, and refused when it does not, as the cookie's fields are.
 */
export function readPlaceName(
	raw: Readonly<Record<string, unknown>>,
	lists: boolean,
	{ field, source, place }: { field: string; source: string; place: string },
	invalid: (detail: string) => GraiError,
): string | undefined {
	const name = raw[field];
	if (!lists) {
		if (name === undefined) return undefined;
		throw invalid(
			`"${field}" is read only by the "${source}" strategy, which "strategy" does not list`,
		);
	}
	if (typeof name !== "string" || name === "") {
		throw invalid(
			`"${field}" must name ${place} the "${source}" strategy reads`,
		);
	}
	return name;
}
