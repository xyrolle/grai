// The types of medians.mjs, for the scripts that read the benches' results in TypeScript.

/** The median: the middle value, or the mean of the middle two. */
export function median(values: readonly number[]): number;

/** The narrowest interval of order statistics that holds the median with at least 95% confidence. */
export function medianInterval(values: readonly number[]): {
	low: number;
	high: number;
	confidence: number;
};
