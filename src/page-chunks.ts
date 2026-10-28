import { add, type Bits, bits, members } from "./bits.ts";
import type { KeyReach } from "./key-reach.ts";
import { keySets } from "./key-sets.ts";

/**
 * The bytes a request is worth to a page: two sets of keys share a chunk when the requests that
 * saves, at this many bytes each, outweigh the bytes it has pages and imports load for nothing.
 */
export const requestBytes = 600;

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
	const sets = keySets(
		[...reach.of].map(([key, entries]) => ({
			key,
			weight: bytesOf(key),
			...contextsOf(entries),
		})),
		requestBytes,
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
