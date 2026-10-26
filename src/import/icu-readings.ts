/**
 * What one way of reading an ICU message needs of a selector's value: one key, or none of the keys
 * a choice lists, which is what its `other` means.
 */
export type Need = { is: string } | { not: ReadonlySet<string> };

/** One way an ICU message reads: what it needs of each selector it chooses on, and its pattern. */
export type Reading = {
	needs: ReadonlyMap<string, Need>;
	/** In grai's pattern syntax, escapes included. */
	pattern: string;
};

/** A reading that needs nothing of any selector. */
export function plainReading(pattern: string): Reading {
	return { needs: new Map(), pattern };
}

/**
 * Each reading of `a` followed by each of `b`, needing what both need. Two that need what no value
 * gives, such as `one` of one choice on a count and `other` of another, never read together.
 */
export function followed(
	a: readonly Reading[],
	b: readonly Reading[],
): Reading[] {
	return a.flatMap((first) =>
		b.flatMap((second) => {
			const needs = bothNeeds(first.needs, second.needs);
			return needs === undefined
				? []
				: [{ needs, pattern: first.pattern + second.pattern }];
		}),
	);
}

/** The reading, needing `needs` too, or none when no value gives both. */
export function needing(
	reading: Reading,
	needs: ReadonlyMap<string, Need>,
): Reading[] {
	const all = bothNeeds(reading.needs, needs);
	return all === undefined ? [] : [{ needs: all, pattern: reading.pattern }];
}

/** What a value of each selector must be for both, or nothing when no value is. */
function bothNeeds(
	a: ReadonlyMap<string, Need>,
	b: ReadonlyMap<string, Need>,
): Map<string, Need> | undefined {
	const needs = new Map(a);
	for (const [selector, need] of b) {
		const known = needs.get(selector);
		const both = known === undefined ? need : bothOf(known, need);
		if (both === undefined) return undefined;
		needs.set(selector, both);
	}
	return needs;
}

function bothOf(a: Need, b: Need): Need | undefined {
	if ("is" in a) return allows(b, a.is) ? a : undefined;
	if ("is" in b) return allows(a, b.is) ? b : undefined;
	return { not: new Set([...a.not, ...b.not]) };
}

/** Whether a selector's value meets the need; `undefined` stands for a value no key names. */
export function allows(need: Need, value: string | undefined): boolean {
	if ("is" in need) return value === need.is;
	return value === undefined || !need.not.has(value);
}
