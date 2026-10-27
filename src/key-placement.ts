import type { Compilation } from "./compilation.ts";
import type { KeyGroups } from "./saved-groups.ts";

/**
 * Where each key's module is in the output, its place: its group's, when the groups saved for the
 * outdir hold it, else its shard among the keys no group holds, by a hash of its name. The groups
 * come first, each at its index in the saved list, then the shards.
 */
export type Placement = {
	/** The groups the placement was made from, as JSON: a render keeps a placement only for the same. */
	groups: string;
	/** How many places there are, the groups' and then the shards'. */
	count: number;
	/** A key's place. */
	of: (key: string) => number;
	/** A place's name in `keys/`: `g` and its group's index, or its shard's index. */
	label: (place: number) => string;
};

/** About how many keys a shard holds, so an edit rewrites one small module and its declarations. */
const keysPerShard = 512;

/** The placement of these keys by these groups; with none, every key is in its hash's shard. */
export function placementOf(
	groups: KeyGroups,
	keys: Iterable<string>,
): Placement {
	const groupOf = new Map<string, number>();
	groups.forEach((group, index) => {
		for (const key of group) groupOf.set(key, index);
	});
	let ungrouped = 0;
	for (const key of keys) if (!groupOf.has(key)) ungrouped += 1;
	const shards = shardCount(ungrouped);
	return {
		groups: JSON.stringify(groups),
		count: groups.length + shards,
		of: (key) => groupOf.get(key) ?? groups.length + shardOf(key, shards),
		label: (place) =>
			place < groups.length ? `g${place}` : String(place - groups.length),
	};
}

/** Every key at its place, each place's keys sorted. */
export function placedKeys(
	keys: Iterable<string>,
	placement: Placement,
): string[][] {
	const places = Array.from({ length: placement.count }, (): string[] => []);
	for (const key of keys) places[placement.of(key)]?.push(key);
	for (const place of places) place.sort();
	return places;
}

/** A place's keys, sorted, after the changed keys of that place came or went. */
export function replaced(
	keys: readonly string[],
	place: number,
	placement: Placement,
	compilation: Compilation,
): string[] {
	const next = new Set(keys);
	for (const key of compilation.changed) {
		if (placement.of(key) !== place) continue;
		if (compilation.keys.has(key)) next.add(key);
		else next.delete(key);
	}
	return [...next].sort();
}

/** A power of two, so a key changes shard only when the key count doubles. */
function shardCount(keys: number): number {
	let shards = 1;
	while (shards * keysPerShard < keys) shards *= 2;
	return shards;
}

/** The shard of a key: its name's FNV-1a hash, modulo the shard count. */
function shardOf(key: string, shards: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index++) {
		hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
	}
	return (hash >>> 0) % shards;
}
