import {
	add,
	addAll,
	type Bits,
	bits,
	members,
	sharedSize,
	size,
} from "./bits.ts";
import type { KeyReach } from "./key-reach.ts";

/**
 * The bytes a request is worth to a page: two sets of keys share a chunk when the requests that
 * saves, at this many bytes each, outweigh the bytes it has pages and imports load for nothing.
 */
export const requestBytes = 600;

/** Keys that the same contexts load, and the bytes one locale's copy of them takes. */
type KeySet = {
	keys: string[];
	contexts: Bits;
	/** How many contexts load the set. */
	contextCount: number;
	bytes: number;
	firstPaint: boolean;
};

/**
 * The chunk of each key, by name. A key's contexts are what loads it: the pages whose first paint
 * loads an entry that reaches it (a page is the entries in one of `pages`, or without them each user
 * entry alone), and each other entry that reaches it, a dynamic import's target. Keys the same
 * contexts load share a chunk, which none of them loads in vain. Two such sets share a chunk too when
 * the requests that saves, at `requestBytes` each, outweigh the bytes it has their other contexts load
 * in vain. The keys a first paint needs and those only a later import needs never share a chunk.
 */
export function pageChunks(
	reach: KeyReach,
	bytesOf: (key: string) => number,
	pages: readonly (readonly string[])[] | undefined,
): Map<string, string> {
	const contextsOf = contextsIn(reach, pages);
	const sets = merged(
		bySameContexts(
			[...reach.of].map(([key, entries]) => ({
				key,
				bytes: bytesOf(key),
				...contextsOf(entries),
			})),
		),
	);
	return new Map(
		sets.flatMap((set) => {
			const name = `grai~${set.keys[0]?.replace(/^\0grai:(\w+)\//, "$1-")}`;
			return set.keys.map((key) => [key, name]);
		}),
	);
}

/** The contexts that load a module its entries reach, and whether a first paint is among them. */
function contextsIn(
	reach: KeyReach,
	pages: readonly (readonly string[])[] | undefined,
): (entries: Bits) => { contexts: Bits; firstPaint: boolean } {
	const index = new Map(reach.entries.map((id, at) => [id, at]));
	const pagesOf = reach.entries.map(() => [] as number[]);
	const listed =
		pages ?? reach.entries.flatMap((id, at) => (reach.user[at] ? [[id]] : []));
	listed.forEach((page, at) => {
		for (const entry of page) {
			const found = index.get(entry);
			if (found !== undefined) pagesOf[found]?.push(at);
		}
	});
	const own = reach.entries.map((_, at) =>
		pagesOf[at]?.length === 0 ? listed.length + at : undefined,
	);
	const count = listed.length + reach.entries.length;
	return (entries) => {
		const contexts = bits(count);
		let firstPaint = false;
		for (const entry of members(entries)) {
			for (const page of pagesOf[entry] ?? []) {
				add(contexts, page);
				firstPaint = true;
			}
			const alone = own[entry];
			if (alone !== undefined) add(contexts, alone);
		}
		return { contexts, firstPaint };
	};
}

/** Sets in the order of their first key, which no two share. */
const byFirstKey = (a: KeySet, b: KeySet) =>
	(a.keys[0] ?? "") < (b.keys[0] ?? "") ? -1 : 1;

/** One set per contexts and first paint, its keys in order, the sets in order of their first key. */
function bySameContexts(
	keys: readonly {
		key: string;
		bytes: number;
		contexts: Bits;
		firstPaint: boolean;
	}[],
): KeySet[] {
	const sets = new Map<string, KeySet>();
	for (const { key, bytes, contexts, firstPaint } of [...keys].sort((a, b) =>
		a.key < b.key ? -1 : 1,
	)) {
		const id = `${firstPaint}:${contexts.join(",")}`;
		const set = sets.get(id);
		if (set === undefined)
			sets.set(id, {
				keys: [key],
				contexts,
				contextCount: size(contexts),
				bytes,
				firstPaint,
			});
		else {
			set.keys.push(key);
			set.bytes += bytes;
		}
	}
	return [...sets.values()];
}

/**
 * The sets merged, the smallest first, each into the set whose merging gains the most if one gains
 * anything: the requests saved, at `requestBytes` each, for every context that loads both, less the
 * bytes loaded in vain by the contexts that load only one. Pass after pass, while one merges any.
 */
function merged(sets: KeySet[]): KeySet[] {
	let live = [...sets];
	for (let merging = true; merging; ) {
		merging = false;
		live.sort((a, b) => a.bytes - b.bytes || byFirstKey(a, b));
		const gone = new Set<KeySet>();
		for (const from of live) {
			const into = bestPartner(
				from,
				live.filter((set) => !gone.has(set)),
			);
			if (into === undefined) continue;
			into.keys.push(...from.keys);
			into.bytes += from.bytes;
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
): KeySet | undefined {
	let best: { into: KeySet; gain: number } | undefined;
	for (const into of sets) {
		if (into === from || into.firstPaint !== from.firstPaint) continue;
		const both = sharedSize(from.contexts, into.contexts);
		if (both === 0) continue;
		const gain =
			requestBytes * both -
			(from.contextCount - both) * into.bytes -
			(into.contextCount - both) * from.bytes;
		if (gain > (best?.gain ?? 0)) best = { into, gain };
	}
	return best?.into;
}
