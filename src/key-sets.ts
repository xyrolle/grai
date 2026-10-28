import { addAll, type Bits, has, members, sharedSize, size } from "./bits.ts";

/**
 * Keys that the same contexts load, and what they weigh: what each context that loads them pays for
 * them, in the unit of the cost of a set.
 */
export type KeySet = {
	keys: string[];
	contexts: Bits;
	/** How many contexts load the set. */
	contextCount: number;
	weight: number;
	firstPaint: boolean;
};

/** A key, what it weighs, the contexts that load it, and whether a first paint is among them. */
export type WeighedKey = {
	key: string;
	weight: number;
	contexts: Bits;
	firstPaint: boolean;
};

/**
 * Keys in sets that each context loads whole: one set per set of contexts, then merged, the smallest
 * first, while a merge saves more than it costs. A context that loads both sets saves `setCost`, what
 * one more set costs it (a request, a module); one that loads only one of them pays the other's
 * weight in vain. The keys a first paint needs and those only a later import needs never share a set.
 */
export function keySets(
	keys: readonly WeighedKey[],
	setCost: number,
): KeySet[] {
	return merged(bySameContexts(keys), setCost);
}

/** Sets in the order of their first key, which no two share. */
const byFirstKey = (a: KeySet, b: KeySet) =>
	(a.keys[0] ?? "") < (b.keys[0] ?? "") ? -1 : 1;

/** One set per contexts and first paint, its keys in order, the sets in order of their first key. */
function bySameContexts(keys: readonly WeighedKey[]): KeySet[] {
	const sets = new Map<string, KeySet>();
	for (const { key, weight, contexts, firstPaint } of [...keys].sort((a, b) =>
		a.key < b.key ? -1 : 1,
	)) {
		const id = `${firstPaint}:${contexts.join(",")}`;
		const set = sets.get(id);
		if (set === undefined)
			sets.set(id, {
				keys: [key],
				contexts,
				contextCount: size(contexts),
				weight,
				firstPaint,
			});
		else {
			set.keys.push(key);
			set.weight += weight;
		}
	}
	return [...sets.values()];
}

/**
 * The sets merged, the smallest first, each into the set whose merging gains the most if one gains
 * anything: `setCost` saved for every context that loads both, less the weight loaded in vain by the
 * contexts that load only one. Pass after pass, while one merges any. Only a set that shares a
 * context can gain, so each set weighs those alone, found through the sets of each context, in the
 * order of the pass: a merge then costs the sets that share its contexts, not every pair of sets.
 */
function merged(sets: KeySet[], setCost: number): KeySet[] {
	let live = [...sets];
	for (let merging = true; merging; ) {
		merging = false;
		live.sort((a, b) => a.weight - b.weight || byFirstKey(a, b));
		const order = new Map(live.map((set, at) => [set, at]));
		const loading = setsOfContexts(live);
		const gone = new Set<KeySet>();
		/** The set each set was last weighed for, so a set that shares several contexts is weighed once. */
		const weighedFor = new Map<KeySet, KeySet>();
		for (const from of live) {
			let best: { into: KeySet; gain: number; at: number } | undefined;
			for (const context of members(from.contexts)) {
				for (const into of loading.get(context) ?? []) {
					if (into === from || gone.has(into) || weighedFor.get(into) === from)
						continue;
					weighedFor.set(into, from);
					const gain = gainOf(from, into, setCost);
					const at = order.get(into) ?? 0;
					// The most gain, and of equal gains the set first in the pass's order.
					if (
						gain > (best?.gain ?? 0) ||
						(best !== undefined && gain === best.gain && at < best.at)
					)
						best = { into, gain, at };
				}
			}
			if (best === undefined) continue;
			const { into } = best;
			for (const context of members(from.contexts)) {
				if (!has(into.contexts, context)) loading.get(context)?.push(into);
			}
			into.keys.push(...from.keys);
			into.weight += from.weight;
			addAll(into.contexts, from.contexts);
			into.contextCount = size(into.contexts);
			gone.add(from);
			merging = true;
		}
		live = live.filter((set) => !gone.has(set));
	}
	return live;
}

/** The sets each context loads, by the context. */
function setsOfContexts(sets: readonly KeySet[]): Map<number, KeySet[]> {
	const loading = new Map<number, KeySet[]>();
	for (const set of sets) {
		for (const context of members(set.contexts)) {
			const known = loading.get(context);
			if (known === undefined) loading.set(context, [set]);
			else known.push(set);
		}
	}
	return loading;
}

/**
 * What merging `from` into `into` gains: `setCost` for every context that loads both, less the
 * weight loaded in vain by the contexts that load only one; nothing for sets a first paint and a
 * later import load apart, which never merge.
 */
function gainOf(from: KeySet, into: KeySet, setCost: number): number {
	if (into.firstPaint !== from.firstPaint) return 0;
	const both = sharedSize(from.contexts, into.contexts);
	if (both === 0) return 0;
	return (
		setCost * both -
		(from.contextCount - both) * into.weight -
		(into.contextCount - both) * from.weight
	);
}
