import { expect, it, vi } from "vitest";
import { add, bits } from "../src/bits.ts";
import { keySets, type WeighedKey } from "../src/key-sets.ts";

// Each weighing of two sets measures what contexts they share: counting those measures counts the
// merge's comparisons.
const { compared } = vi.hoisted(() => ({ compared: { count: 0 } }));
vi.mock("../src/bits.ts", async (actual) => {
	const bits = await actual<typeof import("../src/bits.ts")>();
	return {
		...bits,
		sharedSize: (a: Uint32Array, b: Uint32Array) => {
			compared.count += 1;
			return bits.sharedSize(a, b);
		},
	};
});

it("weighs no two of thousands of sets that share no context, rather than every pair of them", () => {
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
	// Every pair would be about 9 million comparisons, 3,000 × 2,999.
	expect(compared.count).toBeLessThan(3_000);
});
