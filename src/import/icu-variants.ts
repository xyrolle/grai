import type { Branch } from "./converted.ts";
import { allows, type Reading } from "./icu-readings.ts";

/**
 * A selector of an ICU message's selection, in the order MessageFormat 2 weighs them, with the
 * values it can take when they are few: a plural's categories. An input can take any value.
 */
export type SelectorValues = {
	name: string;
	values: readonly string[] | undefined;
};

/** A value for each selector, in their order; `undefined` stands for a value no key names. */
type Point = readonly (string | undefined)[];

/**
 * The readings of an ICU message as the variants of one MessageFormat 2 selection. Each writes
 * the keys it needs, and `*` for a selector it needs no key of, which MessageFormat 2's preference
 * for a key over `*` reads as ICU's choices do while a choice's selectors come before those of the
 * choices in its options. A choice repeated in another's option can break that. When some value
 * would then be read wrong, each reading is written once for every key a reading names of each
 * selector it needs no key of, so that `*` stands only for the values no reading names.
 */
export function variantsOf(
	readings: readonly Reading[],
	selectors: readonly SelectorValues[],
): Branch[] {
	const named = selectors.map(({ name }) => namedKeys(readings, name));
	const branches = readings.map((reading) => ({
		keys: neededKeys(reading),
		pattern: reading.pattern,
	}));
	if (readsAsChosen(readings, branches, selectors, named)) return branches;
	return readings.flatMap((reading) => spelledOut(reading, selectors, named));
}

/** The keys a reading needs, each as itself. */
function neededKeys(reading: Reading): Map<string, string> {
	const keys = new Map<string, string>();
	for (const [selector, need] of reading.needs) {
		if ("is" in need) keys.set(selector, need.is);
	}
	return keys;
}

/** Every key a reading names of the selector, needed or ruled out. */
function namedKeys(readings: readonly Reading[], selector: string): string[] {
	const keys = new Set<string>();
	for (const { needs } of readings) {
		const need = needs.get(selector);
		if (need === undefined) continue;
		for (const key of "is" in need ? [need.is] : need.not) keys.add(key);
	}
	return [...keys];
}

/**
 * Whether, for every value the selectors can take, MessageFormat 2 chooses the variant of the
 * reading ICU reads: the first, in its order of preference, whose keys all match.
 */
function readsAsChosen(
	readings: readonly Reading[],
	branches: readonly Branch[],
	selectors: readonly SelectorValues[],
	named: readonly string[][],
): boolean {
	const ranked = branches
		.map((branch, index) => ({ branch, reading: readings[index] }))
		.toSorted((a, b) => preference(a.branch, b.branch, selectors));
	const domains = selectors.map(
		({ values }, index) => values ?? [...(named[index] ?? []), undefined],
	);
	return pointsOf(domains).every((point) => {
		const chosen = ranked.find(({ branch }) =>
			selectors.every(({ name }, index) => {
				const key = branch.keys.get(name);
				return key === undefined || key === point[index];
			}),
		);
		return chosen?.reading === readingAt(readings, selectors, point);
	});
}

/** MessageFormat 2's preference: selector by selector, a key before `*`. */
function preference(
	a: Branch,
	b: Branch,
	selectors: readonly SelectorValues[],
): number {
	for (const { name } of selectors) {
		const keyed = Number(b.keys.has(name)) - Number(a.keys.has(name));
		if (keyed !== 0) return keyed;
	}
	return 0;
}

/** The reading whose needs the point meets, as ICU chooses it. */
function readingAt(
	readings: readonly Reading[],
	selectors: readonly SelectorValues[],
	point: Point,
): Reading | undefined {
	return readings.find(({ needs }) =>
		selectors.every(({ name }, index) => {
			const need = needs.get(name);
			return need === undefined || allows(need, point[index]);
		}),
	);
}

/** Every point of the domains, one value of each. */
function pointsOf(
	domains: readonly (readonly (string | undefined)[])[],
): Point[] {
	return domains.reduce<Point[]>(
		(points, values) =>
			points.flatMap((point) => values.map((value) => [...point, value])),
		[[]],
	);
}

/**
 * The reading written once for each key some reading names of each selector it needs no key of,
 * and once with `*` there.
 */
function spelledOut(
	reading: Reading,
	selectors: readonly SelectorValues[],
	named: readonly string[][],
): Branch[] {
	let keys: ReadonlyMap<string, string>[] = [new Map()];
	for (const [index, { name }] of selectors.entries()) {
		const need = reading.needs.get(name);
		if (need !== undefined && "is" in need) {
			keys = keys.map((known) => new Map([...known, [name, need.is]]));
			continue;
		}
		const allowed = (named[index] ?? []).filter(
			(key) => need === undefined || allows(need, key),
		);
		keys = keys.flatMap((known) => [
			...allowed.map((key) => new Map([...known, [name, key]])),
			known,
		]);
	}
	return keys.map((written) => ({ keys: written, pattern: reading.pattern }));
}
