import { addAll, type Bits, sharedSize, size } from "./bits.ts";

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
 * contexts that load only one. Pass after pass, while one merges any.
 */
function merged(sets: KeySet[], setCost: number): KeySet[] {
	let live = [...sets];
	for (let merging = true; merging; ) {
		merging = false;
		live.sort((a, b) => a.weight - b.weight || byFirstKey(a, b));
		const gone = new Set<KeySet>();
		for (const from of live) {
			const into = bestPartner(
				from,
				live.filter((set) => !gone.has(set)),
				setCost,
			);
			if (into === undefined) continue;
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

/** The set `from` gains most by merging into, if any gains. */
function bestPartner(
	from: KeySet,
	sets: readonly KeySet[],
	setCost: number,
): KeySet | undefined {
	let best: { into: KeySet; gain: number } | undefined;
	for (const into of sets) {
		if (into === from || into.firstPaint !== from.firstPaint) continue;
		const both = sharedSize(from.contexts, into.contexts);
		if (both === 0) continue;
		const gain =
			setCost * both -
			(from.contextCount - both) * into.weight -
			(into.contextCount - both) * from.weight;
		if (gain > (best?.gain ?? 0)) best = { into, gain };
	}
	return best?.into;
}
