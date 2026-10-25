/**
 * A set of small integers as bits, 32 to a word: the entries that reach a module, or the contexts
 * that load a set of keys. A build's thousands of modules each hold one, so they stay a few words.
 */
export type Bits = Uint32Array;

export const bits = (size: number): Bits =>
	new Uint32Array(Math.ceil(size / 32));

export function add(set: Bits, member: number): void {
	set[member >>> 5] = (set[member >>> 5] ?? 0) | (1 << (member & 31));
}

export function has(set: Bits, member: number): boolean {
	return ((set[member >>> 5] ?? 0) & (1 << (member & 31))) !== 0;
}

/** Adds `from`'s members to `into`, and says whether `into` gained any. */
export function addAll(into: Bits, from: Bits): boolean {
	let gained = false;
	from.forEach((word, index) => {
		const before = into[index] ?? 0;
		const after = before | word;
		if (after !== before) {
			into[index] = after;
			gained = true;
		}
	});
	return gained;
}

export function overlaps(a: Bits, b: Bits): boolean {
	return a.some((word, index) => (word & (b[index] ?? 0)) !== 0);
}

export function size(set: Bits): number {
	return set.reduce((count, word) => count + ones(word), 0);
}

/** How many members `a` and `b` share; the merge rule asks it of every pair of sets, so a plain loop. */
export function sharedSize(a: Bits, b: Bits): number {
	let count = 0;
	for (let index = 0; index < a.length; index++) {
		const word = (a[index] ?? 0) & (b[index] ?? 0);
		if (word !== 0) count += ones(word);
	}
	return count;
}

export function members(set: Bits): number[] {
	const found: number[] = [];
	set.forEach((word, index) => {
		for (let bit = 0; bit < 32; bit++)
			if (word & (1 << bit)) found.push(index * 32 + bit);
	});
	return found;
}

/** The members of a word, counted by halving it into pairs, nibbles and bytes. */
function ones(word: number): number {
	let count = word - ((word >>> 1) & 0x55555555);
	count = (count & 0x33333333) + ((count >>> 2) & 0x33333333);
	return (((count + (count >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
