import { expect, it } from "vitest";
import { add, addAll, bits, sharedSize, size } from "../src/bits.ts";
import { type KeySet, keySets, type WeighedKey } from "../src/key-sets.ts";

/** A generator of numbers in [0, 1) from a seed, so each run draws the same sets. */
function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

/** `count` keys of random weights, each loaded by a few of `contexts` contexts. */
function weighedKeys(
	count: number,
	contexts: number,
	seed: number,
): WeighedKey[] {
	const random = seeded(seed);
	return Array.from({ length: count }, (_, index) => {
		const loaded = bits(contexts);
		const loading = 1 + Math.floor(random() * 3);
		for (let each = 0; each < loading; each++)
			add(loaded, Math.floor(random() * contexts));
		return {
			key: `key${index}`,
			weight: Math.floor(random() * 20_000),
			contexts: loaded,
			firstPaint: random() < 0.8,
		};
	});
}

/**
 * The merge as it was written first, weighing every pair of sets: one set per contexts, then the
 * smallest first into the set it gains most by, pass after pass. The merge must agree with it.
 */
function everyPair(keys: readonly WeighedKey[], setCost: number): KeySet[] {
	const byId = new Map<string, KeySet>();
	for (const { key, weight, contexts, firstPaint } of [...keys].sort((a, b) =>
		a.key < b.key ? -1 : 1,
	)) {
		const id = `${firstPaint}:${contexts.join(",")}`;
		const set = byId.get(id);
		if (set === undefined)
			byId.set(id, {
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
	let live = [...byId.values()];
	for (let merging = true; merging; ) {
		merging = false;
		live.sort(
			(a, b) =>
				a.weight - b.weight || ((a.keys[0] ?? "") < (b.keys[0] ?? "") ? -1 : 1),
		);
		const gone = new Set<KeySet>();
		for (const from of live) {
			let best: { into: KeySet; gain: number } | undefined;
			for (const into of live) {
				if (
					gone.has(into) ||
					into === from ||
					into.firstPaint !== from.firstPaint
				)
					continue;
				const both = sharedSize(from.contexts, into.contexts);
				if (both === 0) continue;
				const gain =
					setCost * both -
					(from.contextCount - both) * into.weight -
					(into.contextCount - both) * from.weight;
				if (gain > (best?.gain ?? 0)) best = { into, gain };
			}
			if (best === undefined) continue;
			best.into.keys.push(...from.keys);
			best.into.weight += from.weight;
			addAll(best.into.contexts, from.contexts);
			best.into.contextCount = size(best.into.contexts);
			gone.add(from);
			merging = true;
		}
		live = live.filter((set) => !gone.has(set));
	}
	return live;
}

it("merges sets of keys as weighing every pair of sets does, set for set, in the same order", () => {
	for (const [count, contexts, seed] of [
		[40, 6, 1],
		[300, 20, 2],
		[800, 120, 3],
		[800, 800, 4],
	] as const) {
		for (const setCost of [600, 12_000]) {
			const merged = keySets(weighedKeys(count, contexts, seed), setCost);
			const expected = everyPair(weighedKeys(count, contexts, seed), setCost);
			expect(merged.map((set) => set.keys)).toEqual(
				expected.map((set) => set.keys),
			);
		}
	}
});

it("merges thousands of sets that share no context, as many routes' own keys are, each left alone", () => {
	const keys = Array.from({ length: 3_000 }, (_, index): WeighedKey => {
		const loaded = bits(3_000);
		add(loaded, index);
		return {
			key: `key${index}`,
			weight: 240,
			contexts: loaded,
			firstPaint: true,
		};
	});

	expect(keySets(keys, 12_000)).toHaveLength(3_000);
});
